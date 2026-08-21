/**
 * Reading what the Gemini and Kimi CLIs actually emit.
 *
 * These two ship the same JSONL event kinds — `system`, `assistant`, `user`,
 * `tool_call`, `tool_result`, `result`, `error` — taken from the shipped CLI
 * rather than from documentation. Neither is installed on the machine this was
 * written on, so the reader is exercised against those shapes directly. That is
 * a weaker claim than driving the real binary and it is stated as such: what is
 * proved here is that the reader handles the format, not that the format is
 * eternally correct.
 *
 * The tolerance is the part worth testing. These CLIs rename fields between
 * minor versions, and the failure that matters is not a lost tool annotation —
 * it is an empty reply because one key moved.
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { BUILD } from './env.mjs'

const { translateGeminiEvent, buildGeminiArgs } = await import(
  pathToFileURL(path.join(BUILD, 'geminiStream.js')).href
)

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const RUN = 'run_1'
const t = (event, sawText = false) => translateGeminiEvent(RUN, event, sawText)

console.log('\n-- the answer, however it is shaped --')

check(
  'a bare text field',
  t({ type: 'assistant', text: 'hello' }).some((e) => e.type === 'assistant-text' && e.text === 'hello'),
)
check(
  'a nested message',
  t({ type: 'assistant', message: { text: 'nested' } }).some((e) => e.text === 'nested'),
)
check(
  'an Anthropic-style content array',
  t({ type: 'assistant', message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } })
    .some((e) => e.text === 'ab'),
)
check(
  'a content array of bare strings',
  t({ type: 'assistant', content: ['x', 'y'] }).some((e) => e.text === 'xy'),
)

console.log('\n-- tools --')

const call = t({ type: 'tool_call', id: 'c1', name: 'read_file', input: { path: 'a.ts' } })
check('a tool call carries its name and input',
  call.some((e) => e.type === 'tool-use' && e.name === 'read_file' && e.id === 'c1'), JSON.stringify(call))

const nested = t({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 'c2', name: 'write', input: {} }] },
})
check('a tool call nested in the assistant turn is still seen',
  nested.some((e) => e.type === 'tool-use' && e.id === 'c2'), JSON.stringify(nested))

const ok = t({ type: 'tool_result', id: 'c1', text: 'contents' })
check('a successful result is marked ok', ok.some((e) => e.type === 'tool-result' && e.ok === true))

for (const shape of [{ is_error: true }, { error: 'boom' }, { status: 'error' }]) {
  const bad = t({ type: 'tool_result', id: 'c1', ...shape })
  check(`a failure written as ${Object.keys(shape)[0]} is marked failed`,
    bad.some((e) => e.type === 'tool-result' && e.ok === false), JSON.stringify(bad))
}

console.log('\n-- the final line --')

const finalFirst = t({ type: 'result', text: 'the whole answer', total_cost_usd: 0.01 })
check('a run that streamed nothing gets the answer from the result line',
  finalFirst.some((e) => e.type === 'assistant-text' && e.text === 'the whole answer'))
check('and its cost', finalFirst.some((e) => e.type === 'done' && e.costUsd === 0.01))

const finalAfter = t({ type: 'result', text: 'the whole answer' }, true)
check('a run that already streamed does not receive it twice',
  !finalAfter.some((e) => e.type === 'assistant-text'), JSON.stringify(finalAfter))
check('but still completes', finalAfter.some((e) => e.type === 'done'))

check('an errored result is not reported ok',
  t({ type: 'result', is_error: true }).some((e) => e.type === 'done' && e.ok === false))

console.log('\n-- sessions, errors and noise --')

check('a session id is reported',
  t({ type: 'system', session_id: 's1' }).some((e) => e.type === 'session' && e.sessionId === 's1'))
check('under either spelling',
  t({ type: 'system', sessionId: 's2' }).some((e) => e.type === 'session' && e.sessionId === 's2'))
check('an error line becomes an error',
  t({ type: 'error', message: 'went wrong' }).some((e) => e.type === 'error' && e.message === 'went wrong'))
check('the echoed prompt is not mistaken for a reply',
  t({ type: 'user', text: 'my prompt' }).every((e) => e.type !== 'assistant-text'))
check('an unknown event type is ignored rather than throwing',
  Array.isArray(t({ type: 'something_new_in_v2', text: 'x' })))
check('so is a non-object line', t('plain text').length === 0)
check('and null', t(null).length === 0)

console.log('\n-- the arguments --')

const args = buildGeminiArgs({ prompt: 'hi', permissionMode: 'plan' })
check('a plan turn asks for the read-only approval mode',
  args.includes('--approval-mode') && args[args.indexOf('--approval-mode') + 1] === 'plan', args.join(' '))
check('it asks for streaming JSON',
  args.includes('--output-format') && args[args.indexOf('--output-format') + 1] === 'stream-json')
check('the prompt is passed as an argument, so nothing waits on stdin',
  args.includes('--prompt') && args[args.length - 1] === 'hi')

for (const [mode, expected] of [
  ['acceptEdits', 'auto_edit'],
  ['bypassPermissions', 'yolo'],
  ['default', 'default'],
]) {
  const a = buildGeminiArgs({ prompt: 'x', permissionMode: mode })
  check(`${mode} maps to ${expected}`, a[a.indexOf('--approval-mode') + 1] === expected, a.join(' '))
}

check('a model override is passed through',
  buildGeminiArgs({ prompt: 'x', model: 'gemini-2.5-pro' }).includes('gemini-2.5-pro'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
