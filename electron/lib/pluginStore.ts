/**
 * Installing plugins from git, and remembering what is installed.
 *
 * The install is deliberately a plain `git clone` rather than a package
 * registry: the user pastes a repository URL, so what they get is exactly what
 * they can go and read. That also makes updating a `git pull` and pinning a
 * `--branch`, with no server in the middle.
 *
 * Everything lives under `userData/plugins/<id>`, one directory per plugin,
 * alongside a `registry.json` that records where each came from and which
 * permissions the user approved. The registry is the source of truth: a
 * directory with no registry entry is treated as absent and cleaned up, because
 * an entry is the only place consent is recorded.
 */
import { app } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { readJsonFileOrQuarantine, withFileLock, writeJsonFile } from './fileStore'
import {
  validateManifest,
  type InstalledPlugin,
  type PluginInstallProgress,
  type PluginManifest,
  type PluginPermission,
  type PluginSource,
} from '../../shared/plugin'

const exec = promisify(execFile)

export const MANIFEST_NAME = 'nova-plugin.json'

/** Long enough for a cold `npm install` on a slow link, short enough to fail. */
const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const CLONE_TIMEOUT_MS = 5 * 60 * 1000

export function pluginsDir(): string {
  return path.join(app.getPath('userData'), 'plugins')
}

function registryFile(): string {
  return path.join(pluginsDir(), 'registry.json')
}

interface RegistryShape {
  plugins: InstalledPlugin[]
}

async function readRegistry(): Promise<RegistryShape> {
  const raw = await readJsonFileOrQuarantine<RegistryShape>(registryFile(), { plugins: [] })
  if (!raw || !Array.isArray(raw.plugins)) return { plugins: [] }
  return raw
}

async function writeRegistry(reg: RegistryShape): Promise<void> {
  await writeJsonFile(registryFile(), reg)
}

export async function listPlugins(): Promise<InstalledPlugin[]> {
  const reg = await readRegistry()
  // Drop entries whose directory a user deleted by hand, so the view matches disk.
  const alive: InstalledPlugin[] = []
  let changed = false
  for (const p of reg.plugins) {
    if (await exists(path.join(p.dir, MANIFEST_NAME))) alive.push(p)
    else changed = true
  }
  if (changed) await withFileLock(registryFile(), () => writeRegistry({ plugins: alive }))
  return alive
}

export async function getPlugin(id: string): Promise<InstalledPlugin | undefined> {
  return (await listPlugins()).find((p) => p.manifest.id === id)
}

async function upsert(plugin: InstalledPlugin): Promise<void> {
  // Installing two plugins at once used to have each read the registry, add its
  // own entry, and write back a copy with the other one missing.
  await withFileLock(registryFile(), async () => {
    const reg = await readRegistry()
    const idx = reg.plugins.findIndex((p) => p.manifest.id === plugin.manifest.id)
    if (idx === -1) reg.plugins.push(plugin)
    else reg.plugins[idx] = plugin
    await writeRegistry(reg)
  })
}

export async function setEnabled(id: string, enabled: boolean): Promise<InstalledPlugin | undefined> {
  const plugin = await getPlugin(id)
  if (!plugin) return undefined
  plugin.enabled = enabled
  plugin.status = enabled ? 'active' : 'disabled'
  if (enabled) delete plugin.error
  await upsert(plugin)
  return plugin
}

export async function markError(id: string, error: string): Promise<void> {
  const plugin = await getPlugin(id)
  if (!plugin) return
  plugin.status = 'error'
  plugin.error = error
  await upsert(plugin)
}

export async function uninstall(id: string): Promise<void> {
  const reg = await readRegistry()
  const plugin = reg.plugins.find((p) => p.manifest.id === id)
  reg.plugins = reg.plugins.filter((p) => p.manifest.id !== id)
  await writeRegistry(reg)
  // Only ever remove a directory we placed inside the plugins root.
  if (plugin && isInside(pluginsDir(), plugin.dir)) {
    await fs.rm(plugin.dir, { recursive: true, force: true })
  }
}

/** Raised when an install stops to ask about the manifest's build command. */
export class PluginBuildConsentError extends Error {
  readonly command: string
  constructor(command: string, name: string) {
    super(`${name} wants to run \`${command}\` on install. Review it and install again to allow it.`)
    this.name = 'PluginBuildConsentError'
    this.command = command
  }
}

export interface InstallOptions {
  url: string
  ref?: string
  /** Permissions the user approved in the install dialog. */
  grantedPermissions?: PluginPermission[]
  /** Re-clone over an existing install of the same id. */
  force?: boolean
  /**
   * The user has seen the manifest's build command and agreed to run it.
   *
   * Installing a plugin *is* running its code, and the build command is the
   * first place that happens — before any permission the user ticked has been
   * consulted, because it runs on the clone rather than through the host. So
   * the install stops at it and asks, rather than treating the paste of a URL
   * as consent to execute whatever the repository's manifest names.
   */
  allowBuild?: boolean
  onProgress?: (p: PluginInstallProgress) => void
}

/**
 * Clones, validates and (if the manifest asks) builds a plugin.
 *
 * The clone lands in a temporary directory first. A repository is only promoted
 * to its real `<id>` directory once its manifest parses and validates, so a
 * malformed plugin can never overwrite a working one that happens to share an
 * id — the failure mode that would otherwise brick a user's setup.
 */
export async function installFromGit(opts: InstallOptions): Promise<InstalledPlugin> {
  const { url, ref, onProgress } = opts
  const report = (stage: PluginInstallProgress['stage'], message: string, pluginId?: string) =>
    onProgress?.({ url, stage, message, pluginId })

  assertSafeGitUrl(url)

  await fs.mkdir(pluginsDir(), { recursive: true })
  const staging = path.join(pluginsDir(), `.staging-${Date.now().toString(36)}`)
  await fs.rm(staging, { recursive: true, force: true })

  try {
    report('cloning', `Cloning ${url}…`)
    const cloneArgs = ['clone', '--depth', '1', '--single-branch']
    if (ref) cloneArgs.push('--branch', ref)
    // `--` stops a URL that starts with a dash being read as a flag.
    cloneArgs.push('--', url, staging)
    await exec('git', cloneArgs, {
      timeout: CLONE_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        // Never let a clone block the app waiting for a credential prompt.
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
      },
    })

    report('validating', 'Reading nova-plugin.json…')
    const manifest = await readManifest(staging)

    const commit = await headCommit(staging)
    const dir = path.join(pluginsDir(), manifest.id)

    const existing = await getPlugin(manifest.id)
    if (existing && !opts.force) {
      throw new Error(
        `${manifest.name} (${manifest.id}) is already installed. Use Update to pull the latest commit, or reinstall to replace it.`,
      )
    }

    // Asked before promotion, so refusing leaves nothing installed.
    if (manifest.build && !opts.allowBuild) {
      onProgress?.({
        url,
        stage: 'needs-build-consent',
        message: `${manifest.name} runs a build command when it is installed.`,
        pluginId: manifest.id,
        buildCommand: manifest.build,
      })
      throw new PluginBuildConsentError(manifest.build, manifest.name)
    }

    // Promote: swap staging into place only now that the manifest is good.
    await fs.rm(dir, { recursive: true, force: true })
    await fs.rename(staging, dir)

    if (manifest.build) {
      report('building', `Running: ${manifest.build}`, manifest.id)
      await runBuild(dir, manifest.build)
    }

    const source: PluginSource = { kind: 'git', url, ref, commit }
    const plugin: InstalledPlugin = {
      manifest,
      source,
      dir,
      enabled: true,
      status: 'active',
      installedAt: existing?.installedAt ?? Date.now(),
      updatedAt: Date.now(),
      // Never grant more than the manifest asks for, even if the caller says so.
      grantedPermissions: (opts.grantedPermissions ?? manifest.permissions ?? []).filter((p) =>
        (manifest.permissions ?? []).includes(p),
      ),
    }
    await upsert(plugin)
    report('done', `Installed ${manifest.name} ${manifest.version}`, manifest.id)
    return plugin
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true })
    const message = errText(err)
    report('error', message)
    throw new Error(message)
  }
}

/** Pulls the latest commit for a git-installed plugin and rebuilds it. */
export async function updatePlugin(
  id: string,
  onProgress?: (p: PluginInstallProgress) => void,
): Promise<InstalledPlugin> {
  const plugin = await getPlugin(id)
  if (!plugin) throw new Error(`${id} is not installed.`)
  if (plugin.source.kind !== 'git') throw new Error(`${id} was not installed from git.`)

  const report = (stage: PluginInstallProgress['stage'], message: string) =>
    onProgress?.({ url: plugin.source.url, stage, message, pluginId: id })

  report('cloning', 'Fetching latest…')
  await exec('git', ['fetch', '--depth', '1', 'origin'], {
    cwd: plugin.dir,
    timeout: CLONE_TIMEOUT_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  const branch = plugin.source.ref || (await currentBranch(plugin.dir))
  await exec('git', ['reset', '--hard', `origin/${branch}`], { cwd: plugin.dir })

  report('validating', 'Re-reading manifest…')
  const manifest = await readManifest(plugin.dir)
  if (manifest.id !== id) {
    throw new Error(`The updated repository declares id "${manifest.id}", not "${id}". Uninstall and reinstall it.`)
  }

  if (manifest.build) {
    report('building', `Running: ${manifest.build}`)
    await runBuild(plugin.dir, manifest.build)
  }

  const updated: InstalledPlugin = {
    ...plugin,
    manifest,
    source: { ...plugin.source, commit: await headCommit(plugin.dir) },
    updatedAt: Date.now(),
    status: plugin.enabled ? 'active' : 'disabled',
    // A new version may ask for more than the user previously approved. Keep the
    // old grant set; anything newly requested stays ungranted until re-approved.
    grantedPermissions: plugin.grantedPermissions.filter((p) => (manifest.permissions ?? []).includes(p)),
  }
  delete updated.error
  await upsert(updated)
  report('done', `Updated to ${manifest.version}`)
  return updated
}

/** Permissions a plugin's manifest asks for that the user has not approved. */
export function ungrantedPermissions(plugin: InstalledPlugin): PluginPermission[] {
  return (plugin.manifest.permissions ?? []).filter((p) => !plugin.grantedPermissions.includes(p))
}

export async function grantPermissions(id: string, permissions: PluginPermission[]): Promise<void> {
  const plugin = await getPlugin(id)
  if (!plugin) return
  const asked = plugin.manifest.permissions ?? []
  plugin.grantedPermissions = Array.from(
    new Set([...plugin.grantedPermissions, ...permissions.filter((p) => asked.includes(p))]),
  )
  await upsert(plugin)
}

async function readManifest(dir: string): Promise<PluginManifest> {
  const file = path.join(dir, MANIFEST_NAME)
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`No ${MANIFEST_NAME} at the repository root. Nova plugins must have one.`)
    }
    throw new Error(`${MANIFEST_NAME} is not valid JSON: ${errText(err)}`)
  }
  const { manifest, errors } = validateManifest(raw)
  if (!manifest) throw new Error(`${MANIFEST_NAME} is invalid:\n${errors.map((e) => `  • ${e}`).join('\n')}`)

  if (manifest.main && !(await exists(path.join(dir, manifest.main)))) {
    throw new Error(`\`main\` points at ${manifest.main}, which does not exist in the repository.`)
  }
  return manifest
}

/**
 * Runs the manifest's build command.
 *
 * This executes repository-supplied shell, which is the same trust the user
 * extends by installing at all — but it is the single most dangerous moment, so
 * it is bounded by a timeout and never inherits an interactive stdin.
 */
async function runBuild(dir: string, command: string): Promise<void> {
  const shell = process.platform === 'win32' ? 'cmd' : '/bin/sh'
  const args = process.platform === 'win32' ? ['/c', command] : ['-lc', command]
  try {
    await exec(shell, args, {
      cwd: dir,
      timeout: BUILD_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CI: '1', npm_config_yes: 'true' },
    })
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; killed?: boolean }
    if (e.killed) throw new Error(`Build timed out after ${BUILD_TIMEOUT_MS / 60000} minutes: ${command}`)
    throw new Error(`Build failed (${command}):\n${(e.stderr || e.stdout || '').slice(-4000)}`)
  }
}

async function headCommit(dir: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['rev-parse', 'HEAD'], { cwd: dir })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function currentBranch(dir: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir })
    const name = stdout.trim()
    return name && name !== 'HEAD' ? name : 'HEAD'
  } catch {
    return 'HEAD'
  }
}

/**
 * Refuses URLs that git would treat as something other than a remote fetch.
 *
 * `ext::` transports hand git an arbitrary command to run, and a local path
 * with `--upload-pack` does the same, so a pasted "repository" can be a code
 * execution primitive before any manifest is read.
 */
function assertSafeGitUrl(url: string): void {
  const trimmed = url.trim()
  if (!trimmed) throw new Error('Enter a git repository URL.')
  if (trimmed.startsWith('-')) throw new Error('That does not look like a repository URL.')
  if (/^ext::/i.test(trimmed)) throw new Error('`ext::` git URLs are not allowed: they run arbitrary commands.')
  if (/--upload-pack|--receive-pack|--config|-c\s/i.test(trimmed)) {
    throw new Error('That URL contains git options, which are not allowed.')
  }
  // `file://` is allowed so a plugin author can install the repository they are
  // editing without pushing it somewhere first.
  const allowed = /^(https?:\/\/|git:\/\/|ssh:\/\/|file:\/\/|git@[\w.-]+:)/i
  if (!allowed.test(trimmed)) {
    throw new Error('Use an https://, ssh://, file:// or git@host:path repository URL.')
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child)
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function errText(err: unknown): string {
  const e = err as { stderr?: string; message?: string }
  return (e.stderr || e.message || String(err)).trim()
}
