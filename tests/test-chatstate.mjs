/**
 * Storing a conversation without storing a run.
 *
 * The bug this covers is a spinner that never stops: a chat saved mid-turn kept
 * `running: true`, and restoring it restored a message claiming to be working
 * on a run that had ended with the window it was started in.
 */
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const { settleMessage, settleMessages } = await import(
  pathToFileURL(`${BUILD}/chatMessages.js`).href
)

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n-- ${t} --`)

const live = { id: 'a1', role: 'assistant', parts: [{ kind: 'log', text: 'CLI output' }], changes: [], running: true, runId: 'run_1' }
const done = { id: 'a2', role: 'assistant', parts: [], changes: [] }

section('a stored message is not a run')
let out = settleMessage(live)
check('running is dropped', !('running' in out))
check('runId is dropped', !('runId' in out))
check('everything else survives', out.id === 'a1' && out.parts[0].text === 'CLI output')
check('the original is not mutated', live.running === true && live.runId === 'run_1')

out = settleMessage(done)
check('a settled message is returned unchanged', out === done)

section('across a conversation')
const conversation = [done, live, { id: 'u1', role: 'user', parts: [], changes: [] }]
const settled = settleMessages(conversation)
check('every live flag is cleared', settled.every((m) => m.running === undefined && m.runId === undefined))
check('order and length are kept', settled.length === 3 && settled[0].id === 'a2' && settled[2].id === 'u1')
check('a conversation with nothing live is returned as-is', settleMessages([done]) !== null)
check('and is the same array, so React sees no change', settleMessages([done, done]).length === 2)

section('the shape that caused the bug')
// A turn saved by the debounced mid-stream persist: parts arrived, `done` never did.
const midStream = [
  { id: 'u', role: 'user', parts: [{ kind: 'text', text: 'build it' }], changes: [] },
  { id: 'a', role: 'assistant', parts: [{ kind: 'log', text: 'CLI output' }], changes: [], running: true, runId: 'run_9' },
]
const reopened = settleMessages(midStream)
check('the restored turn does not spin', reopened[1].running === undefined)
check('its output is still readable', reopened[1].parts[0].text === 'CLI output')
check('it cannot be matched to a future run', reopened[1].runId === undefined)

section('running: false is normalised too')
const explicit = settleMessage({ id: 'x', running: false, runId: 'r' })
check('an explicit false is dropped rather than stored', !('running' in explicit))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
