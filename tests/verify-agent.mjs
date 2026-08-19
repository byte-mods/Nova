/**
 * The agent console's memory: plans, their revisions, and the providers.
 *
 * These are the parts that outlive a turn. A transcript can be re-read from the
 * screen; a plan that was superseded, a step the user struck out before
 * approving, and the test result that arrived after the agent claimed success
 * are all things that used to vanish — so they are checked against what is
 * actually persisted rather than against what is on screen.
 *
 * Plans are seeded through the store rather than by paying for real agent runs.
 * What is under test here is the record, not the model: whether a second plan
 * is filed as a revision, whether discarding keeps it, whether a late result
 * lands on the right plan, and whether it all survives a reload. Real
 * plan-then-execute turns are covered by section 13 of verify-ui.mjs.
 *
 * Start the app first:  bash tests/restart-app.sh
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'
import { startVendorEndpoint } from './stubs/vendor-endpoint.mjs'

const PROJECT = path.join(TMP, 'agent-demo')

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

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })
await fs.writeFile(PROJECT + '/package.json', '{"name":"agent-demo","version":"1.0.0"}')
await fs.writeFile(path.join(PROJECT, 'src', 'a.ts'), 'export const a = 1\n')
await fs.writeFile(path.join(PROJECT, 'api.http'), '### Ping\nGET https://example.test/ping\n')

const cdp = await connect()
const j = (v) => JSON.stringify(v)

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().openProject(${j(PROJECT)})
  return true`)
await cdp.sleep(2500)

// A chat of its own, so nothing here depends on what an earlier suite left.
await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().newChat()
  return true`)
await cdp.sleep(800)

const seed = (id, request, steps, extra = {}) => `
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().setPlan({
    id: ${j(id)},
    request: ${j(request)},
    summary: 'Seeded by verify-agent.',
    steps: ${j(steps)}.map((text, i) => ({ id: 's' + i, text, status: 'pending' })),
    status: 'proposed',
    createdAt: Date.now(),
    ...${j(extra)},
  })
  return true`

console.log('\n-- a plan is kept, not just shown --')

await cdp.evaluate(seed('plan_one', 'Add a greeting module', ['Create greet.ts', 'Export it', 'Test it']))
await cdp.sleep(400)

const first = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore.getState()
  return { plans: s.plans.length, activeId: s.plan?.id, steps: s.plan?.steps.length }`)
check('the plan becomes the active one', first.activeId === 'plan_one', j(first))
check('and is filed in the history', first.plans === 1, `${first.plans} in history`)
check('with its steps', first.steps === 3, `${first.steps} steps`)

console.log('\n-- a second attempt is a revision, not a replacement --')

await cdp.evaluate(
  seed('plan_two', 'Add a greeting module', ['Create greet.ts', 'Export it', 'Document it'], {
    supersedes: 'plan_one',
  }),
)
await cdp.sleep(400)

const second = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore.getState()
  return { plans: s.plans.length, ids: s.plans.map((p) => p.id), activeId: s.plan?.id }`)
check('the earlier plan is still there', second.plans === 2, j(second.ids))
check('and the newer one is active', second.activeId === 'plan_two', j(second.activeId))

const delta = await cdp.evaluate(`
  const { diffPlans } = await import('/src/lib/planning.ts')
  const s = (await import('/src/state/store.ts')).useStore.getState()
  const [a, b] = s.plans
  return diffPlans(a, b)`)
check(
  'the revision reports what was added',
  delta.some((d) => d.kind === 'added' && /Document/.test(d.text)),
  j(delta),
)
check(
  'and what was dropped',
  delta.some((d) => d.kind === 'removed' && /Test/.test(d.text)),
  j(delta),
)
check(
  'and does not report unchanged steps as churn',
  delta.filter((d) => d.kind === 'kept').length === 2,
  j(delta.map((d) => d.kind)),
)

console.log('\n-- discarding keeps the record --')

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().discardPlan()
  return true`)
await cdp.sleep(400)

const discarded = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore.getState()
  return {
    active: s.plan,
    plans: s.plans.length,
    status: s.plans.find((p) => p.id === 'plan_two')?.status,
  }`)
check('the card goes away', discarded.active === null, j(discarded.active))
check('the plan is kept in the history', discarded.plans === 2, `${discarded.plans}`)
check('marked as rejected rather than deleted', discarded.status === 'rejected', j(discarded.status))

console.log('\n-- a late result lands on the right plan --')

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().patchPlan('plan_one', (p) => ({
    ...p,
    verification: { state: 'failed', framework: 'vitest', passed: 6, failed: 1,
      total: 7, failures: ['greet › returns a greeting'], durationMs: 900, ranAt: Date.now() },
  }))
  return true`)
await cdp.sleep(400)

const late = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore.getState()
  return {
    onPlanOne: s.plans.find((p) => p.id === 'plan_one')?.verification?.state,
    onPlanTwo: s.plans.find((p) => p.id === 'plan_two')?.verification ?? null,
    active: s.plan,
  }`)
check('the result is written to the plan it belongs to', late.onPlanOne === 'failed', j(late.onPlanOne))
check('not to the other one', late.onPlanTwo === null, j(late.onPlanTwo))
check(
  'and a finished plan is not dragged back to being active',
  late.active === null,
  j(late.active),
)

console.log('\n-- it survives a reload --')

const chatId = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().persistChat()
  return s.getState().activeChatId`)

const reloaded = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().newChat()
  await s.getState().switchChat(${j(chatId)})
  const st = s.getState()
  return {
    plans: st.plans.length,
    ids: st.plans.map((p) => p.id),
    verification: st.plans.find((p) => p.id === 'plan_one')?.verification?.state,
    supersedes: st.plans.find((p) => p.id === 'plan_two')?.supersedes,
  }`, 30000)
check('every plan comes back', reloaded.plans === 2, j(reloaded.ids))
check('with its test result', reloaded.verification === 'failed', j(reloaded.verification))
check('and its link to what it replaced', reloaded.supersedes === 'plan_one', j(reloaded.supersedes))

console.log('\n-- the history panel --')

const panel = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ aiVisible: true })
  await new Promise((r) => setTimeout(r, 400))
  const btn = [...document.querySelectorAll('.ai-header .icon-btn')]
    .find((b) => (b.title || '').startsWith('Plans this conversation'))
  if (!btn) return { missing: true }
  btn.click()
  await new Promise((r) => setTimeout(r, 600))
  const rows = [...document.querySelectorAll('.plan-history-row')]
  return {
    missing: false,
    rows: rows.length,
    text: rows.map((r) => r.textContent).join(' | '),
  }`)
check('the panel opens from the header', panel.missing === false, j(panel))
check('and lists every plan', panel.rows === 2, `${panel.rows} rows`)
check('newest first', /Add a greeting module/.test(panel.text ?? ''), (panel.text ?? '').slice(0, 80))
check(
  'showing the test result on the plan that has one',
  /1 failed|6\/7 pass/.test(panel.text ?? ''),
  (panel.text ?? '').slice(0, 160),
)

console.log('\n-- the providers --')

const providers = await cdp.evaluate(`return await window.nova.ai.providers()`, 60000)
const ids = providers.map((p) => p.id)
check(
  'all six providers are offered',
  ['claude', 'codex', 'opencode', 'kimi', 'glm', 'deepseek'].every((id) => ids.includes(id)),
  j(ids),
)
check(
  'a vendor provider with no key is not reported as usable',
  providers.filter((p) => ['kimi', 'glm', 'deepseek'].includes(p.id)).every((p) => !p.available),
  j(providers.filter((p) => ['kimi', 'glm', 'deepseek'].includes(p.id)).map((p) => [p.id, p.available])),
)
check(
  'and says how to make it usable',
  providers
    .filter((p) => ['kimi', 'glm', 'deepseek'].includes(p.id))
    .every((p) => /API key|Claude Code CLI/i.test(p.hint)),
  j(providers.find((p) => p.id === 'kimi')?.hint),
)

// Starting a keyless vendor run must fail with an explanation rather than
// reaching the network and returning whatever the vendor says about auth.
const keyless = await cdp.evaluate(`
  const events = []
  const off = window.nova.ai.onEvent((e) => events.push(e))
  const { runId } = await window.nova.ai.start({
    provider: 'deepseek', prompt: 'hello', cwd: ${j(PROJECT)},
  })
  await window.nova.ai.ack(runId)
  await new Promise((r) => setTimeout(r, 1500))
  off()
  return events.filter((e) => e.runId === runId).map((e) => ({ type: e.type, message: e.message }))
`, 60000)
check(
  'a run with no key is refused before anything is spawned',
  keyless.some((e) => e.type === 'error' && /API key/i.test(e.message ?? '')),
  j(keyless),
)
check('and the run is closed out rather than left hanging', keyless.some((e) => e.type === 'done'), j(keyless.map((e) => e.type)))

console.log('\n-- storing a key --')

const keyFlow = await cdp.evaluate(`
  const saved = await window.nova.ai.setKey('deepseek', 'test-key-not-real')
  const stored = await window.nova.ai.storedKeys()
  const providers = await window.nova.ai.providers()
  const cleared = await window.nova.ai.setKey('deepseek', null)
  const after = await window.nova.ai.storedKeys()
  return { saved, stored, cleared, after, available: providers.find((p) => p.id === 'deepseek')?.available }
`, 60000)
check('a key can be stored', keyFlow.saved === true, j(keyFlow.saved))
check('the provider reports having one', keyFlow.stored.includes('deepseek'), j(keyFlow.stored))
check('and becomes usable', keyFlow.available === true, j(keyFlow.available))
check('the key is never handed back to the renderer', !j(keyFlow).includes('test-key-not-real'), 'the value appeared in the reply')
check('and it can be forgotten', !keyFlow.after.includes('deepseek'), j(keyFlow.after))

console.log('\n-- a vendor run reaches the vendor, with the vendor key --')

/*
 * The whole point of this section. `ANTHROPIC_AUTH_TOKEN` on its own does not
 * override a logged-in Claude session, so a DeepSeek run went out carrying the
 * user's personal Anthropic OAuth token — to DeepSeek. Nothing inside the app
 * shows that: the run succeeds either way. Only the headers on the wire do.
 */
const vendor = await startVendorEndpoint()

const routed = await cdp.evaluate(
  `
  await window.nova.ai.setKey('deepseek', 'sk-vendor-verifyagent')
  const events = []
  const off = window.nova.ai.onEvent((e) => events.push(e))
  const { runId } = await window.nova.ai.start({
    provider: 'deepseek',
    prompt: 'say hello',
    cwd: ${j(PROJECT)},
    baseUrl: ${j(vendor.origin)},
  })
  await window.nova.ai.ack(runId)
  await new Promise((r) => setTimeout(r, 15000))
  off()
  await window.nova.ai.setKey('deepseek', null)
  return events
    .filter((e) => e.runId === runId)
    .map((e) => ({ type: e.type, text: (e.text ?? e.message ?? '').slice(0, 120) }))
`,
  90000,
)

const credentials = vendor.credentials()
check('the run reaches the configured endpoint', vendor.requests.length > 0, `${vendor.requests.length} requests`)
check(
  'the reply is parsed by the Claude stream reader',
  routed.some((e) => e.type === 'assistant-text' && /stub reply/.test(e.text)),
  j(routed.map((e) => e.type)),
)
check(
  'the vendor key is the credential presented',
  credentials.some((c) => c.includes('sk-vendor-verifyagent')),
  j(credentials.map((c) => c.slice(0, 22))),
)
check(
  'and no personal Anthropic token is sent to the vendor',
  !credentials.some((c) => /sk-ant-/.test(c)),
  j(credentials.map((c) => c.slice(0, 22))),
)

await vendor.close()

console.log('\n-- viewers can watch the agent work --')

/*
 * Read from outside the app, over the loopback surface the tunnel fronts. What
 * matters here is what a viewer is handed: the plan and the shape of the edits,
 * and specifically *not* absolute paths or file contents, neither of which was
 * part of what the user chose to share.
 */
const shared = await cdp.evaluate(
  `
  await window.nova.share.start(${j(PROJECT)}, { mode: 'project', follow: true })
  let status = await window.nova.share.status()
  for (let i = 0; i < 60 && !status.localUrl; i++) {
    await new Promise((r) => setTimeout(r, 500))
    status = await window.nova.share.status()
  }

  const s = (await import('/src/state/store.ts')).useStore
  s.getState().setPlan({
    id: 'plan_shared',
    request: 'Add a greeting module',
    summary: '',
    status: 'executing',
    createdAt: Date.now(),
    steps: [
      { id: 's0', text: 'Create greet.ts', status: 'done' },
      { id: 's1', text: 'Export it', status: 'running' },
    ],
    edits: [{ path: ${j(PROJECT)} + '/src/greet.ts', additions: 12, deletions: 3, kind: 'create' }],
    verification: { state: 'passed', framework: 'vitest', passed: 7, failed: 0,
      total: 7, failures: [], durationMs: 800, ranAt: Date.now() },
  })
  await new Promise((r) => setTimeout(r, 1200))
  return { localUrl: status.localUrl }
`,
  180000,
)

const agentSeen = shared.localUrl
  ? await fetch(`${shared.localUrl}agent`).then((r) => r.json())
  : null

check('the share exposes what the agent is doing', agentSeen?.active === true, j(agentSeen)?.slice(0, 120))
check('with the request', /greeting module/.test(agentSeen?.request ?? ''), j(agentSeen?.request))
check('and the steps, with their state', agentSeen?.steps?.length === 2, j(agentSeen?.steps))
check(
  'showing which one is in progress',
  agentSeen?.steps?.some((s) => s.status === 'running'),
  j(agentSeen?.steps?.map((s) => s.status)),
)
check(
  'the files it changed, with line counts',
  agentSeen?.edits?.[0]?.additions === 12 && agentSeen?.edits?.[0]?.deletions === 3,
  j(agentSeen?.edits),
)
check(
  'as project-relative paths, not the presenter’s directory layout',
  agentSeen?.edits?.[0]?.path === 'src/greet.ts',
  j(agentSeen?.edits?.[0]?.path),
)
check('and what the tests said', agentSeen?.verification?.state === 'passed', j(agentSeen?.verification))
check(
  'but never the contents of what it edited',
  !j(agentSeen).includes('export const'),
  'file content appeared in the agent payload',
)

const viewerPage = shared.localUrl ? await fetch(shared.localUrl).then((r) => r.text()) : ''
check('the viewer page has somewhere to show it', /id="agent"/.test(viewerPage), '')

// A collection share must not start reporting on the source the agent edits.
const collectionLeak = await cdp.evaluate(
  `
  await window.nova.share.stop()
  await window.nova.share.start(${j(PROJECT)}, { mode: 'collection', file: ${j(PROJECT)} + '/api.http', follow: true })
  let status = await window.nova.share.status()
  for (let i = 0; i < 60 && !status.localUrl; i++) {
    await new Promise((r) => setTimeout(r, 500))
    status = await window.nova.share.status()
  }
  await window.nova.share.agent({
    active: true, request: 'should not be published', status: 'executing',
    steps: [], edits: [], running: true,
  })
  await new Promise((r) => setTimeout(r, 600))
  return status.localUrl
`,
  180000,
)
const collectionAgent = collectionLeak
  ? await fetch(`${collectionLeak}agent`).then((r) => r.json())
  : null
check(
  'a collection share is never told about the agent',
  collectionAgent?.active === false,
  j(collectionAgent),
)

await cdp.evaluate(`await window.nova.share.stop(); return true`, 60000)

console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
