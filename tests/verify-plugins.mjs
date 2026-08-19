/**
 * The plugin system, end to end, against the running IDE.
 *
 * A plugin is the one subsystem where the interesting failures are all at the
 * seams — clone, manifest validation, the fork, the permission gate, the rpc
 * hop back — and none of them are reachable from a unit test. So this installs
 * a real plugin from a real git repository and drives it through the same
 * bridge the Plugins view uses.
 *
 * The plugin is built here rather than committed as a fixture, because what is
 * being checked is the contract in shared/plugin.ts: if the manifest shape or
 * the host API changes under it, this should stop compiling in spirit, and a
 * committed blob would quietly keep passing.
 *
 * Start the app first:  bash tests/restart-app.sh
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'

const exec = promisify(execFile)

const REPO_DIR = path.join(TMP, 'plugin-src')
const PROJECT = path.join(TMP, 'plugin-demo')
const PLUGIN_ID = 'dev.nova.verify'

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ------------------------------------------------------------------ */
/* the plugin under test                                               */
/* ------------------------------------------------------------------ */

/**
 * Declares `workspace:read` and `ui` but deliberately *not* `workspace:write`,
 * so the deny path can be exercised on a plugin the user did approve — which is
 * the case that matters. A plugin nobody installed proves nothing.
 */
const MANIFEST = {
  id: PLUGIN_ID,
  name: 'Verify Plugin',
  version: '1.0.0',
  description: 'Installed by tests/verify-plugins.mjs.',
  main: 'index.mjs',
  permissions: ['workspace:read', 'ui'],
  contributes: {
    commands: [
      { id: 'greet', title: 'Verify: Greet', category: 'Verify' },
      { id: 'countFiles', title: 'Verify: Count Files' },
      { id: 'readDenied', title: 'Verify: Attempt Denied Write' },
      { id: 'remember', title: 'Verify: Round-trip Storage' },
    ],
    views: [{ id: 'panel', title: 'Verify', location: 'panel' }],
  },
}

const ENTRY = `
export async function activate(nova) {
  nova.log.info('verify plugin activating')

  nova.commands.register('greet', (args) => ({
    greeting: 'hello ' + (args && args.who ? args.who : 'world'),
    id: nova.plugin.id,
  }))

  // Granted: workspace:read.
  nova.commands.register('countFiles', async () => {
    const root = await nova.workspace.root()
    const entries = await nova.workspace.list('.')
    return { root, count: entries.length }
  })

  // Not granted: workspace:write. Must throw at the call site.
  nova.commands.register('readDenied', async () => {
    try {
      await nova.workspace.writeFile('should-not-exist.txt', 'nope')
      return { denied: false, message: '' }
    } catch (err) {
      return { denied: true, message: String(err && err.message ? err.message : err) }
    }
  })

  nova.commands.register('remember', async () => {
    await nova.storage.set('counter', 41)
    const back = await nova.storage.get('counter')
    return { back }
  })

  await nova.ui.setViewHtml('panel', '<h1 id="verify-view">Verify panel</h1>')
}

export function deactivate() {}
`

async function buildPluginRepo() {
  await fs.rm(REPO_DIR, { recursive: true, force: true })
  await fs.mkdir(REPO_DIR, { recursive: true })
  await fs.writeFile(path.join(REPO_DIR, 'nova-plugin.json'), JSON.stringify(MANIFEST, null, 2))
  await fs.writeFile(path.join(REPO_DIR, 'index.mjs'), ENTRY)

  const git = (...args) =>
    exec('git', args, {
      cwd: REPO_DIR,
      env: { ...process.env, GIT_AUTHOR_NAME: 'Nova Tests', GIT_AUTHOR_EMAIL: 'tests@nova.dev', GIT_COMMITTER_NAME: 'Nova Tests', GIT_COMMITTER_EMAIL: 'tests@nova.dev' },
    })

  await git('init', '-q', '-b', 'main')
  await git('add', '-A')
  await git('commit', '-qm', 'the plugin')
}

async function buildProject() {
  await fs.rm(PROJECT, { recursive: true, force: true })
  await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
  await fs.writeFile(path.join(PROJECT, 'package.json'), '{"name":"plugin-demo","version":"1.0.0"}')
  await fs.writeFile(path.join(PROJECT, 'src', 'a.ts'), 'export const a = 1\n')
  await fs.writeFile(path.join(PROJECT, 'src', 'b.ts'), 'export const b = 2\n')
}

/* ------------------------------------------------------------------ */

await buildPluginRepo()
await buildProject()

const cdp = await connect()
const json = (v) => JSON.stringify(v)

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openProject(${json(PROJECT)})
  return true
`)
await cdp.sleep(2500)

// A leftover from an earlier run would make "install" mean "reinstall".
await cdp.evaluate(`
  try { await window.nova.plugins.uninstall(${json(PLUGIN_ID)}) } catch {}
  return true
`)

console.log('\n-- installing from a git repository --')

const installed = await cdp.evaluate(
  `
  const progress = []
  const off = window.nova.plugins.onInstallProgress((p) => progress.push(p.stage + ':' + p.message))
  try {
    const plugin = await window.nova.plugins.install(${json(`file://${REPO_DIR}`)}, { force: true })
    return { ok: true, plugin, progress }
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err), progress }
  } finally {
    if (typeof off === 'function') off()
  }
`,
  120000,
)

check('the repository clones and installs', installed.ok, installed.error ?? '')
check(
  'the manifest is read back',
  installed.plugin?.manifest?.id === PLUGIN_ID && installed.plugin?.manifest?.name === 'Verify Plugin',
  json(installed.plugin?.manifest?.id),
)
check(
  'the resolved commit is recorded so it can be updated',
  /^[0-9a-f]{7,40}$/.test(installed.plugin?.source?.commit ?? ''),
  json(installed.plugin?.source),
)
check(
  'only the permissions the manifest asked for are granted',
  json(installed.plugin?.grantedPermissions?.slice().sort()) === json(['ui', 'workspace:read']),
  json(installed.plugin?.grantedPermissions),
)
check(
  'the install reported its stages',
  (installed.progress ?? []).some((p) => p.startsWith('cloning')) &&
    (installed.progress ?? []).some((p) => p.startsWith('validating')),
  json(installed.progress),
)

console.log('\n-- activation --')

await cdp.sleep(1500)
const runtime = await cdp.evaluate(`
  const states = await window.nova.plugins.runtime()
  const list = await window.nova.plugins.list()
  return { states, mine: list.find((p) => p.manifest.id === ${json(PLUGIN_ID)}) }
`)
const mineRuntime = (runtime.states ?? []).find((s) => s.pluginId === PLUGIN_ID)

check('the plugin is active, not errored', runtime.mine?.status === 'active', json(runtime.mine?.status) + ' ' + json(runtime.mine?.error))
check('the host reports it as loaded', Boolean(mineRuntime), json((runtime.states ?? []).map((s) => s.pluginId)))
check(
  'the commands it registered are known to the editor',
  (mineRuntime?.commands ?? []).length >= 4,
  json((mineRuntime?.commands ?? []).map((c) => c.id)),
)

const palette = await cdp.evaluate(`
  const cmds = await window.nova.plugins.commands()
  return cmds.filter((c) => (c.pluginId ?? '') === ${json(PLUGIN_ID)} || String(c.id).includes('verify'))
`)
check('its commands are namespaced for the palette', palette.length >= 4, json(palette.map((c) => c.id ?? c.title)))

console.log('\n-- invoking commands over the bridge --')

const greet = await cdp.evaluate(
  `return await window.nova.plugins.invoke(${json(PLUGIN_ID)}, 'greet', { who: 'Nova' })`,
  30000,
)
check('a command runs in the host and returns its value', greet?.greeting === 'hello Nova', json(greet))
check('the plugin sees its own identity', greet?.id === PLUGIN_ID, json(greet?.id))

const counted = await cdp.evaluate(
  `return await window.nova.plugins.invoke(${json(PLUGIN_ID)}, 'countFiles')`,
  30000,
)
// The app reports the resolved path, and on macOS the temp dir is a symlink
// (/var -> /private/var), so compare what the filesystem says both are.
const projectReal = await fs.realpath(PROJECT)
check(
  'a granted permission reaches the workspace',
  counted?.root === projectReal || counted?.root === PROJECT,
  `${counted?.root} vs ${projectReal}`,
)
check('it read the real project contents', (counted?.count ?? 0) >= 2, json(counted?.count))

console.log('\n-- the permission gate --')

const denied = await cdp.evaluate(
  `return await window.nova.plugins.invoke(${json(PLUGIN_ID)}, 'readDenied')`,
  30000,
)
check('an ungranted call is refused', denied?.denied === true, json(denied))
check(
  'the refusal names the permission and how to get it',
  /workspace:write/.test(denied?.message ?? '') && /nova-plugin\.json/.test(denied?.message ?? ''),
  json(denied?.message),
)
const leaked = await fs
  .access(path.join(PROJECT, 'should-not-exist.txt'))
  .then(() => true)
  .catch(() => false)
check('and nothing was written', !leaked)

console.log('\n-- storage and views --')

const stored = await cdp.evaluate(
  `return await window.nova.plugins.invoke(${json(PLUGIN_ID)}, 'remember')`,
  30000,
)
check('per-plugin storage round-trips', stored?.back === 41, json(stored))

const viewHtml = await cdp.evaluate(
  `return await window.nova.plugins.viewHtml(${json(PLUGIN_ID)}, 'panel')`,
)
check('a contributed view keeps the HTML the plugin set', /verify-view/.test(viewHtml ?? ''), json(viewHtml))

console.log('\n-- the Plugins view --')

// `setSidebarView` is a toggle: calling it for the view already showing hides
// the sidebar. Ask for the end state instead of assuming where it started.
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  if (s.getState().sidebarView !== 'plugins' || !s.getState().sidebarVisible) {
    s.getState().setSidebarView('plugins')
  }
  return true
`)
await cdp.sleep(1200)

const collapsed = await cdp.evaluate(`
  const text = document.querySelector('.sidebar')?.textContent ?? ''
  return { named: text.includes('Verify Plugin'), versioned: text.includes('1.0.0') }
`)
check('the installed plugin is listed', collapsed.named, json(collapsed))
check('with its version', collapsed.versioned, json(collapsed))

// The card holds its detail behind a disclosure, so open it the way a user
// would rather than reading state the screen is not showing.
const expanded = await cdp.evaluate(`
  const head = [...document.querySelectorAll('.plugin-card-head')]
    .find((e) => e.textContent.includes('Verify Plugin'))
  head?.click()
  await new Promise((r) => setTimeout(r, 400))
  const card = head?.closest('.plugin-card')
  const chips = [...(card?.querySelectorAll('.plugin-perms-granted .chip') ?? [])].map((c) => c.textContent.trim())
  const commands = [...(card?.querySelectorAll('.plugin-section .plugin-row .mono') ?? [])].map((c) => c.textContent.trim())
  return { chips, commands, source: card?.querySelector('.plugin-source')?.textContent ?? '' }
`)
check(
  'expanding it shows the permissions it holds',
  expanded.chips.includes('workspace:read') && expanded.chips.includes('ui'),
  json(expanded.chips),
)
check(
  'and the commands it contributed, each runnable',
  expanded.commands.some((c) => c.includes('Greet')),
  json(expanded.commands),
)
check('and where it came from', /plugin-src/.test(expanded.source), json(expanded.source))

console.log('\n-- disable, enable, uninstall --')

const disabled = await cdp.evaluate(
  `
  await window.nova.plugins.setEnabled(${json(PLUGIN_ID)}, false)
  const states = await window.nova.plugins.runtime()
  const list = await window.nova.plugins.list()
  return {
    running: states.some((s) => s.pluginId === ${json(PLUGIN_ID)}),
    status: (list.find((p) => p.manifest.id === ${json(PLUGIN_ID)}) ?? {}).status,
  }
`,
  30000,
)
check('disabling unloads it from the host', !disabled.running, json(disabled))
check('and it is recorded as disabled', disabled.status === 'disabled', json(disabled.status))

const reenabled = await cdp.evaluate(
  `
  await window.nova.plugins.setEnabled(${json(PLUGIN_ID)}, true)
  await new Promise((r) => setTimeout(r, 800))
  const greet = await window.nova.plugins.invoke(${json(PLUGIN_ID)}, 'greet', { who: 'again' })
  return greet
`,
  30000,
)
check('re-enabling loads it back and it works', reenabled?.greeting === 'hello again', json(reenabled))

const gone = await cdp.evaluate(
  `
  await window.nova.plugins.uninstall(${json(PLUGIN_ID)})
  const list = await window.nova.plugins.list()
  const states = await window.nova.plugins.runtime()
  return {
    listed: list.some((p) => p.manifest.id === ${json(PLUGIN_ID)}),
    running: states.some((s) => s.pluginId === ${json(PLUGIN_ID)}),
    dir: await window.nova.plugins.dir(),
  }
`,
  30000,
)
check('uninstalling removes it from the list', !gone.listed, json(gone.listed))
check('and stops it running', !gone.running, json(gone.running))
const dirGone = await fs
  .access(path.join(gone.dir, PLUGIN_ID))
  .then(() => true)
  .catch(() => false)
check('and deletes it from disk', !dirGone, path.join(gone.dir, PLUGIN_ID))

console.log('\n-- what it refuses to install --')

const refusals = await cdp.evaluate(
  `
  const attempt = async (url) => {
    try { await window.nova.plugins.install(url, { force: true }); return '' }
    catch (err) { return String(err && err.message ? err.message : err) }
  }
  return {
    ext: await attempt('ext::sh -c whoami'),
    bare: await attempt('/etc/passwd'),
    empty: await attempt('   '),
  }
`,
  60000,
)
check('an `ext::` URL is refused as a command execution', /ext::/.test(refusals.ext), json(refusals.ext))
check('a bare path is refused', /https?:\/\/|ssh:\/\/|file:\/\//.test(refusals.bare), json(refusals.bare))
check('an empty URL is refused', Boolean(refusals.empty), json(refusals.empty))

console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
