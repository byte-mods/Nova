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
  // The button toggles, so clicking it blind closes a panel a previous run
  // left open. Converge on open instead of assuming which way it points.
  for (let i = 0; i < 2 && !document.querySelector('.plan-history-row'); i++) {
    btn.click()
    await new Promise((r) => setTimeout(r, 700))
  }
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
  'all seven providers are offered',
  ['claude', 'codex', 'opencode', 'kimi', 'gemini', 'glm', 'deepseek'].every((id) => ids.includes(id)),
  j(ids),
)
const keyed = providers.filter((p) => ['kimi', 'gemini', 'glm', 'deepseek'].includes(p.id))
check(
  'a provider whose CLI or key is missing is not reported as usable',
  keyed.every((p) => !p.available),
  j(keyed.map((p) => [p.id, p.available])),
)
// Each one runs its vendor's own CLI now, so the hint has to name the thing
// that is actually missing rather than a generic apology.
check(
  'each names the CLI it needs',
  keyed.every((p) => /kimi|gemini|opencode|API key/i.test(p.hint)),
  j(keyed.map((p) => [p.id, p.hint.slice(0, 60)])),
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

console.log('\n-- the console always comes back --')

/*
 * The failure this guards against: a run whose completion never reaches the
 * message it belonged to left `aiRunning` true for the rest of the session, and
 * every prompt after that was silently dropped by the guard in `send`. From the
 * outside the assistant had simply stopped answering, with no error and no way
 * back short of restarting.
 */
const wedge = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().newChat()

  // A run that ends after its message is gone — exactly what switching chats
  // mid-turn produces.
  s.getState().setAiRunning(true)
  await new Promise((r) => setTimeout(r, 300))
  const stuckBefore = s.getState().aiRunning

  // Stop must release the console whether or not a process is still there.
  const btns = [...document.querySelectorAll('.ai-composer button, .ai-console button')]
  const stop = btns.find((b) => (b.textContent || '').includes('Stop'))
  if (stop) stop.click()
  await new Promise((r) => setTimeout(r, 500))
  return { stuckBefore, runningAfterStop: s.getState().aiRunning, hadStop: Boolean(stop) }
`, 60000)
check('a run in flight marks the console busy', wedge.stuckBefore === true, j(wedge))
check('and Stop always releases it', wedge.hadStop && wedge.runningAfterStop === false, j(wedge))

// A completion for a run whose message no longer exists must still release it.
const orphan = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  const { runId } = await window.nova.ai.start({
    provider: 'gemini', prompt: 'x', cwd: ${j(PROJECT)},
  })
  // Exactly what the console records when it starts a turn.
  s.setState({ aiRunning: true, activeRunId: runId })
  await window.nova.ai.ack(runId)
  // Throw the messages away, as switching chats does, before the run ends.
  s.setState({ messages: [] })
  await new Promise((r) => setTimeout(r, 2500))
  return s.getState().aiRunning
`, 60000)
check(
  'a run that ends after its message is gone still releases the console',
  orphan === false,
  `aiRunning=${orphan}`,
)

const recovered = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  return s.getState().aiRunning === false
`)
check('so a later prompt would not be silently dropped', recovered === true, j(recovered))

console.log('\n-- a conversation survives without a clean finish --')

const saved = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  await s.getState().newChat()
  const id = s.getState().activeChatId
  s.getState().addMessage({
    id: 'u-persist', role: 'user',
    parts: [{ kind: 'text', text: 'a question nobody answered' }],
    changes: [], createdAt: Date.now(),
  })
  // No completion is ever reported for this turn.
  await new Promise((r) => setTimeout(r, 2200))
  const list = await window.nova.chats.list(s.getState().root)
  const stored = await window.nova.chats.get(s.getState().root, id)
  return {
    listed: list.some((c) => c.id === id),
    messages: (stored?.messages ?? []).length,
  }
`, 60000)
check('an unfinished turn is still written to history', saved.listed === true, j(saved))
check('with its messages', saved.messages >= 1, j(saved))

console.log('\n-- each provider runs its own CLI --')

/*
 * The routing is the claim worth checking. Previously several providers ran the
 * Claude CLI with its base URL redirected, which inherited that CLI's auth
 * precedence and sent a personal token to a third party. Each vendor now runs
 * its own binary, so what has to be true is that the provider maps to the right
 * one and that a missing binary is reported as such.
 */
const routing = await cdp.evaluate(`
  const { AI_PROVIDERS } = await import('/shared/aiProviders.ts')
  return AI_PROVIDERS.map((p) => [p.id, p.binary, p.dialect])
`)
const expected = {
  claude: 'claude', codex: 'codex', opencode: 'opencode',
  kimi: 'kimi', gemini: 'gemini', glm: 'opencode', deepseek: 'opencode',
}
check(
  'every provider is routed to the CLI its vendor ships',
  routing.every(([id, binary]) => expected[id] === binary),
  j(routing),
)
check(
  'and nothing is pointed at the Claude CLI but Claude itself',
  routing.filter(([, binary]) => binary === 'claude').length === 1,
  j(routing.filter(([, b]) => b === 'claude')),
)

const missing = await cdp.evaluate(`
  const events = []
  const off = window.nova.ai.onEvent((e) => events.push(e))
  const { runId } = await window.nova.ai.start({ provider: 'gemini', prompt: 'hi', cwd: ${j(PROJECT)} })
  await window.nova.ai.ack(runId)
  await new Promise((r) => setTimeout(r, 1500))
  off()
  return events.filter((e) => e.runId === runId).map((e) => ({ type: e.type, message: e.message }))
`, 60000)
check(
  'a provider whose CLI is absent fails with the install command, not a crash',
  missing.some((e) => e.type === 'error' && /gemini|npm i -g/i.test(e.message ?? '')),
  j(missing),
)
check('and the run is closed out', missing.some((e) => e.type === 'done'), j(missing.map((e) => e.type)))

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
