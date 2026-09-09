/**
 * The composer's message queue.
 *
 * Ordering is the part worth testing: an interrupt that lands behind the queue
 * is not an interrupt, and displaced work that lands at the back never resumes.
 */
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const { enqueue, interrupt, dequeue, remove, describeQueue, MAX_QUEUED } = await import(
  pathToFileURL(`${BUILD}/messageQueue.js`).href
)

let pass = 0
let fail = 0
const check = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`) }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`) }
}
const section = (t) => console.log(`\n-- ${t} --`)
const texts = (q) => q.map((m) => m.label)

section('queueing')
let q = enqueue([], 'first')
q = enqueue(q, 'second')
q = enqueue(q, 'third')
check('messages keep the order they were typed', String(texts(q)) === 'first,second,third')
check('whitespace is not a message', enqueue(q, '   ').length === 3)
check('an empty string is not a message', enqueue(q, '').length === 3)
check('text is trimmed', enqueue([], '  padded  ')[0].text === 'padded')
check('ids are unique', new Set(q.map((m) => m.id)).size === 3)

section('taking messages off')
let { next, rest } = dequeue(q)
check('the oldest comes off first', next.label === 'first')
check('the rest keeps its order', String(texts(rest)) === 'second,third')
check('an empty queue yields nothing', dequeue([]).next === null)
check('and does not throw', Array.isArray(dequeue([]).rest))

section('interrupting')
q = enqueue(enqueue([], 'later one'), 'later two')
q = interrupt(q, 'urgent thing', 'the original task')
check('the interruption goes first', q[0].label === 'urgent thing')
check('the displaced work goes second', q[1].resume === true)
check('it is labelled with the original request', q[1].label === 'the original task')
check('already-queued messages keep their place behind both',
  String(texts(q.slice(2))) === 'later one,later two')

const resumePrompt = q[1].text
check('the resume prompt says to pick the work back up', /pick up the work/i.test(resumePrompt))
check('it restates what was originally asked', resumePrompt.includes('the original task'))
check('it warns the work is half-finished', /half-finished|part-way/i.test(resumePrompt))

section('interrupting with nothing to resume')
q = interrupt([], 'just this', undefined)
check('no resume entry is invented', q.length === 1 && !q[0].resume)
q = interrupt([], 'just this', '   ')
check('blank interrupted work adds no entry', q.length === 1)
check('an empty interruption changes nothing', interrupt([{ id: 'x', text: 'a', label: 'a' }], '  ').length === 1)

section('the ceiling')
let big = []
for (let i = 0; i < MAX_QUEUED + 10; i++) big = enqueue(big, `m${i}`)
check(`the queue stops at ${MAX_QUEUED}`, big.length === MAX_QUEUED)
check('and keeps the oldest, not the newest', big[0].label === 'm0')

const full = interrupt(big, 'urgent', 'original')
check('an interrupt still fits when the queue is full', full.length === MAX_QUEUED)
check('the interrupt survives the trim', full[0].label === 'urgent')
check('and so does the resume', full[1].resume === true)

section('removing')
q = enqueue(enqueue(enqueue([], 'a'), 'b'), 'c')
check('a message can be dropped by id', String(texts(remove(q, q[1].id))) === 'a,c')
check('an unknown id changes nothing', remove(q, 'nope').length === 3)

section('what the user is told')
check('an empty queue says nothing', describeQueue([]) === '')
check('one message is singular', describeQueue(enqueue([], 'a')) === '1 message queued')
check('several are plural', describeQueue(enqueue(enqueue([], 'a'), 'b')) === '2 messages queued')
check('a pending resume is called out',
  /interrupted/.test(describeQueue(interrupt([], 'x', 'y'))))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
