/**
 * The pure half of the OpenCode (local model) provider: the argument builder and
 * the `--format json` event translator.
 *
 * These are asserted offline because they are the parts that break silently. An
 * argv mistake produces a CLI that hangs or ignores a flag, and a translator
 * mistake produces a console that renders nothing — neither throws, so only a
 * test catches them.
 *
 * The event fixtures below follow the emitter in opencode's
 * `packages/opencode/src/cli/cmd/run.ts`, which writes
 * `{ type, timestamp, sessionID, ...data }` per line.
 */
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const { buildOpencodeArgs, translateOpencodeEvent, filePathFrom } = await import(
  pathToFileURL(`${BUILD}/opencode.js`).href
)

let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const base = { provider: 'opencode', prompt: 'do the thing', cwd: '/tmp/proj' }
const argsFor = (extra = {}) => buildOpencodeArgs({ ...base, ...extra }, extra.prompt ?? base.prompt)

/* ---------------- the argument builder ---------------- */

const plain = argsFor()

check('runs the headless subcommand', plain[0] === 'run', plain.join(' '))
check('asks for machine-readable output', plain.includes('--format') && plain.includes('json'))
check('passes the working directory explicitly', plain.includes('--dir') && plain.includes('/tmp/proj'))
check('asks for reasoning, so thinking reaches the console', plain.includes('--thinking'))

check(
  'the prompt is the final positional, behind a `--` terminator',
  plain[plain.length - 2] === '--' && plain[plain.length - 1] === 'do the thing',
  plain.slice(-3).join(' '),
)
check(
  'a prompt beginning with a dash cannot become a flag',
  (() => {
    const a = argsFor({ prompt: '--version please' })
    return a[a.length - 2] === '--' && a[a.length - 1] === '--version please'
  })(),
)

/* ---------------- models ---------------- */

check(
  'a provider-qualified model is passed through untouched',
  argsFor({ model: 'anthropic/claude-sonnet-4' }).join(' ').includes('-m anthropic/claude-sonnet-4'),
)
check(
  'a bare model name is assumed to be an Ollama one',
  argsFor({ model: 'qwen2.5-coder:0.5b' }).join(' ').includes('-m ollama/qwen2.5-coder:0.5b'),
)
check('no model means no -m flag at all', !argsFor().includes('-m'))

/* ---------------- permissions ---------------- */

const planned = argsFor({ permissionMode: 'plan' })
check(
  'plan mode uses the read-only agent and withholds --auto',
  planned.includes('--agent') && planned.includes('plan') && !planned.includes('--auto'),
  planned.join(' '),
)
for (const mode of ['acceptEdits', 'bypassPermissions', 'default', undefined]) {
  const a = argsFor({ permissionMode: mode })
  check(
    `${mode ?? 'no mode'} auto-approves, or every write would be rejected`,
    a.includes('--auto') && !a.includes('--agent'),
    a.join(' '),
  )
}

/* ---------------- sessions and attachments ---------------- */

check(
  'resuming passes the session id',
  argsFor({ resumeSessionId: 'ses_123' }).join(' ').includes('--session ses_123'),
)
check(
  'attachments become repeated -f flags',
  (() => {
    const a = argsFor({ attachments: ['/tmp/proj/a.ts', '/tmp/proj/b.ts'] }).join(' ')
    return a.includes('-f /tmp/proj/a.ts') && a.includes('-f /tmp/proj/b.ts')
  })(),
)

/* ---------------- the event translator ---------------- */

const tr = (event, reported = true) => translateOpencodeEvent(event, 'run_1', reported)

const text = tr({ type: 'text', sessionID: 's1', part: { type: 'text', text: 'the answer' } })
check(
  'a completed text part becomes assistant text',
  text.events.length === 1 &&
    text.events[0].type === 'assistant-text' &&
    text.events[0].text === 'the answer' &&
    text.events[0].runId === 'run_1',
  JSON.stringify(text.events),
)
check('text marks the run as having produced output', text.sawText === true)
check(
  'an empty text part produces nothing',
  tr({ type: 'text', part: { text: '   ' } }).events.length === 0,
)

const reasoning = tr({ type: 'reasoning', part: { text: 'considering' } })
check(
  'a reasoning part becomes thinking, not assistant text',
  reasoning.events.length === 1 &&
    reasoning.events[0].type === 'thinking' &&
    reasoning.sawText === false,
  JSON.stringify(reasoning.events),
)

/* ---------------- session reporting ---------------- */

const first = tr({ type: 'text', sessionID: 'ses_abc', part: { text: 'hi' } }, false)
check(
  'the first event reports the session id',
  first.events[0].type === 'session' && first.events[0].sessionId === 'ses_abc',
  JSON.stringify(first.events),
)
check(
  'later events do not repeat it',
  !tr({ type: 'text', sessionID: 'ses_abc', part: { text: 'hi' } }, true).events.some(
    (e) => e.type === 'session',
  ),
)

/* ---------------- tool calls ---------------- */

const tool = tr({
  type: 'tool_use',
  sessionID: 's1',
  part: {
    id: 'prt_9',
    type: 'tool',
    tool: 'edit',
    state: { status: 'completed', input: { filePath: 'src/app.ts' }, output: 'applied' },
  },
})
check(
  'a completed tool emits its call and result back to back',
  tool.events.length === 2 &&
    tool.events[0].type === 'tool-use' &&
    tool.events[0].name === 'edit' &&
    tool.events[1].type === 'tool-result' &&
    tool.events[1].ok === true,
  JSON.stringify(tool.events),
)
check('call and result share an id, so the console can pair them', tool.events[0].id === tool.events[1].id)
check('the edited file is surfaced for the change tracker', tool.file === 'src/app.ts')

const failedTool = tr({
  type: 'tool_use',
  part: { id: 'p', tool: 'bash', state: { status: 'error', input: {}, error: 'exit 1' } },
})
check(
  'a failed tool reports not-ok with its error as the preview',
  failedTool.events[1].ok === false && failedTool.events[1].preview === 'exit 1',
  JSON.stringify(failedTool.events[1]),
)
check(
  'a tool with no file does not claim one',
  failedTool.file === null,
)
check(
  'an enormous tool output is truncated rather than flooding the console',
  tr({
    type: 'tool_use',
    part: { id: 'p', tool: 'bash', state: { status: 'completed', input: {}, output: 'x'.repeat(9000) } },
  }).events[1].preview.length === 4000,
)

/* ---------------- errors ---------------- */

check(
  'a structured error is unwrapped to its message',
  tr({ type: 'error', error: { name: 'ProviderError', data: { message: 'model not found' } } })
    .events[0].message === 'model not found',
)
check(
  'an error with only a name still reports something usable',
  tr({ type: 'error', error: { name: 'UnknownError' } }).events[0].message === 'UnknownError',
)

/* ---------------- noise ---------------- */

for (const type of ['step_start', 'step_finish', 'something.new']) {
  check(`\`${type}\` is ignored rather than logged as noise`, tr({ type, part: {} }).events.length === 0)
}

/* ---------------- the file-path helper ---------------- */

check('filePath is recognised', filePathFrom({ filePath: 'a.ts' }) === 'a.ts')
check('file_path is recognised', filePathFrom({ file_path: 'b.ts' }) === 'b.ts')
check('path is recognised', filePathFrom({ path: 'c.ts' }) === 'c.ts')
check('a non-string is refused', filePathFrom({ filePath: 42 }) === null)
check('an empty object yields null', filePathFrom({}) === null)

console.log(`\nopencode: ${passed}/${passed + failed} passed`)
if (failed) process.exit(1)
