/**
 * The automatic-run loop.
 *
 * Every branch here is a way the loop can misbehave at the user's expense:
 * running forever, stopping early, or believing a completion claim it should
 * have checked. They are cheap to test and expensive to get wrong.
 */
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const {
  readClaim, decideNext, advance, beginAutoRun, openingPrompt, protocolBlock, STALL_LIMIT,
} = await import(pathToFileURL(`${BUILD}/autoRun.js`).href)

let pass = 0
let fail = 0

function check(label, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n-- ${title} --`)
}

const verification = (over = {}) => ({
  state: 'passed', framework: 'vitest', passed: 10, failed: 0, total: 10,
  failures: [], durationMs: 100, ranAt: Date.now(), ...over,
})

section('reading the agent’s claim')

check('a bare marker is read', readClaim('done at last\nNOVA_TASK_COMPLETE').claim === 'done')
check('a fenced marker is read', readClaim('```\nNOVA_TASK_COMPLETE\n```').claim === 'done')
check('a bulleted marker is read', readClaim('- NOVA_CONTINUE').claim === 'working')
check('a bold marker is read', readClaim('**NOVA_TASK_COMPLETE**').claim === 'done')
check('blocked carries its reason',
  readClaim('NOVA_BLOCKED: I need the staging API key').reason === 'I need the staging API key')
check('blocked with no reason still says something',
  readClaim('NOVA_BLOCKED').reason.length > 0)
check('no marker means still working', readClaim('I refactored the parser.').claim === 'working')
check('an empty turn means still working', readClaim('').claim === 'working')
check('the last marker wins, not the first',
  readClaim('First I thought NOVA_TASK_COMPLETE\nbut actually\nNOVA_CONTINUE').claim === 'working')
check('prose about the protocol does not end the run',
  readClaim('The agent should emit NOVA_TASK_COMPLETE when finished.\nNOVA_CONTINUE').claim === 'working')

section('the completion gate')

let state = beginAutoRun('add a cache', 0)
let decision = decideNext(state, { text: 'NOVA_TASK_COMPLETE', filesChanged: 3 })
check('a completion claim runs the tests rather than ending', decision.kind === 'verify')

state = advance(state, decision, { filesChanged: 3 })
check('the run moves to verifying', state.stage === 'verifying')

decision = decideNext(state, {
  text: '', filesChanged: 0,
  verification: verification({ state: 'failed', failed: 2, failures: ['a fails', 'b fails'] }),
})
check('a red suite sends it back to work', decision.kind === 'continue' && decision.stage === 'working')
check('the failures are named in the prompt', decision.prompt.includes('a fails'))
check('the prompt refuses test-deletion as a fix', decision.prompt.includes('do not delete or skip'))

state = advance(beginAutoRun('add a cache', 0), { kind: 'verify' }, { filesChanged: 1 })
decision = decideNext(state, { text: '', filesChanged: 0, verification: verification() })
check('a green suite asks for the manual checks', decision.kind === 'continue' && decision.stage === 'manual')
check('the manual prompt asks for observed results', decision.prompt.includes('actually observed'))

state = advance(state, decision, { filesChanged: 0, verification: verification() })
check('the manual pass is recorded as requested', state.manualRequested === true)
decision = decideNext(state, { text: 'all checked\nNOVA_TASK_COMPLETE', filesChanged: 1 })
check('completing after the manual pass ends the run',
  decision.kind === 'stop' && decision.stage === 'complete')

section('no suite is not a failure')

state = advance(beginAutoRun('write a README', 0), { kind: 'verify' }, { filesChanged: 1 })
decision = decideNext(state, {
  text: '', filesChanged: 0,
  verification: verification({ state: 'unavailable', passed: 0, total: 0, detail: 'no framework' }),
})
check('a project with no tests still reaches the manual pass',
  decision.kind === 'continue' && decision.stage === 'manual')
check('and the prompt says so plainly', decision.prompt.includes('no automated suite'))

section('blocking')

decision = decideNext(beginAutoRun('deploy', 0), {
  text: 'NOVA_BLOCKED: the deploy needs production credentials', filesChanged: 0,
})
check('a blocker stops the run', decision.kind === 'stop' && decision.stage === 'blocked')
check('the reason reaches the user', decision.reason.includes('production credentials'))

section('the stall guard')

state = beginAutoRun('do a thing', 0)
for (let i = 1; i < STALL_LIMIT; i++) {
  decision = decideNext(state, { text: 'thinking about it', filesChanged: 0 })
  check(`turn ${i} with no changes keeps going`, decision.kind === 'continue')
  state = advance(state, decision, { filesChanged: 0 })
}
decision = decideNext(state, { text: 'still thinking', filesChanged: 0 })
check(`${STALL_LIMIT} idle turns stops the run`, decision.kind === 'stop' && decision.stage === 'stalled')
check('the stall reason mentions the cost', /tokens|circles/.test(decision.reason))

state = beginAutoRun('do a thing', 0)
state = advance(state, decideNext(state, { text: 'x', filesChanged: 0 }), { filesChanged: 0 })
state = advance(state, decideNext(state, { text: 'x', filesChanged: 2 }), { filesChanged: 2 })
check('a turn that changes files resets the idle count', state.idleTurns === 0)

section('the verification step is not a turn')

// A regression: the suite-resolving step used to be counted as an agent turn,
// which spent the cap twice as fast and fed the stall guard an idle turn that
// never happened.
state = beginAutoRun('a task', 0)
decision = decideNext(state, { text: 'NOVA_TASK_COMPLETE', filesChanged: 4 })
state = advance(state, decision, { filesChanged: 4 })
check('the claiming turn counts', state.iteration === 1)
check('and it was not idle', state.idleTurns === 0)

decision = decideNext(state, { text: '', filesChanged: 0, verification: verification() })
state = advance(state, decision, { filesChanged: 0, verification: verification() }, false)
check('resolving the suite does not count as a turn', state.iteration === 1)
check('and does not count as idle', state.idleTurns === 0)
check('the verification is remembered', state.verification.state === 'passed')

// Three verifications in a row must not trip the stall guard.
state = beginAutoRun('a task', 0)
for (let i = 0; i < 3; i++) {
  state = advance(state, { kind: 'verify' }, { filesChanged: 1 })
  state = advance(state, { kind: 'continue', prompt: '', stage: 'working' },
    { filesChanged: 0, verification: verification() }, false)
}
check('repeated verification never reaches the stall limit', state.idleTurns < STALL_LIMIT)

section('the iteration cap')

state = { ...beginAutoRun('endless', 3), iteration: 3 }
decision = decideNext(state, { text: 'NOVA_TASK_COMPLETE', filesChanged: 1 })
check('the cap stops even a completing turn', decision.kind === 'stop' && decision.stage === 'stalled')
check('the cap explains how to resume', decision.reason.includes('continue'))

state = { ...beginAutoRun('endless', 0), iteration: 500 }
decision = decideNext(state, { text: 'working', filesChanged: 1 })
check('a zero cap runs uncapped', decision.kind === 'continue')

section('the protocol text')

const opening = openingPrompt('build a thing')
check('the opening carries the goal', opening.includes('build a thing'))
check('the opening forbids checking in', /do not ask whether to proceed/i.test(opening))
check('the protocol lists all three markers',
  ['NOVA_CONTINUE', 'NOVA_TASK_COMPLETE', 'NOVA_BLOCKED'].every((m) => protocolBlock().includes(m)))
check('the protocol says a failing test is not a blocker',
  /failing test.*not.*blocker|none of these are blockers/is.test(protocolBlock()))

const cont = decideNext(beginAutoRun('the original goal', 0), { text: 'more to do', filesChanged: 1 })
check('every continuation restates the goal', cont.prompt.includes('the original goal'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
