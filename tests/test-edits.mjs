import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'
const { applyEdits } = await import(pathToFileURL(`${BUILD}/applyEdits.js`).href)
let fail = 0
const t = (label, got, want) => {
  if (got === want) console.log(`  PASS  ${label}`)
  else { fail++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`) }
}
const R = (sl, sc, el, ec, newText) => ({ range: { start: { line: sl, character: sc }, end: { line: el, character: ec } }, newText })

t('single replacement', applyEdits('let add = 1', [R(0, 4, 0, 7, 'sum')]), 'let sum = 1')

// Two edits on one line, given in ascending order — must not corrupt offsets.
t('two edits same line', applyEdits('add(add(1))', [R(0, 0, 0, 3, 'sum'), R(0, 4, 0, 7, 'sum')]), 'sum(sum(1))')

// Given in descending order too.
t('two edits reversed input', applyEdits('add(add(1))', [R(0, 4, 0, 7, 'sum'), R(0, 0, 0, 3, 'sum')]), 'sum(sum(1))')

t('multi-line edit across lines', applyEdits('a\nb\nc\n', [R(0, 0, 2, 1, 'X')]), 'X\n')

t('insertion (empty range)', applyEdits('ab', [R(0, 1, 0, 1, '-')]), 'a-b')

t('deletion', applyEdits('hello world', [R(0, 5, 0, 11, '')]), 'hello')

t('edit on later line', applyEdits('one\ntwo\nthree', [R(2, 0, 2, 5, 'THREE')]), 'one\ntwo\nTHREE')

t('edits on different lines', applyEdits('one\ntwo\nthree', [R(0, 0, 0, 3, 'ONE'), R(2, 0, 2, 5, 'THREE')]), 'ONE\ntwo\nTHREE')

t('character beyond line end clamps', applyEdits('ab\ncd', [R(0, 99, 0, 99, '!')]), 'ab!\ncd')

let threw = false
try { applyEdits('abcdef', [R(0, 0, 0, 4, 'X'), R(0, 2, 0, 6, 'Y')]) } catch { threw = true }
t('overlapping edits throw instead of corrupting', threw, true)

t('adjacent (non-overlapping) edits both apply', applyEdits('abcdef', [R(0, 0, 0, 3, 'X'), R(0, 3, 0, 6, 'Y')]), 'XY')

t('empty edit list', applyEdits('unchanged', []), 'unchanged')

t('crlf content offsets', applyEdits('a\r\nbb\r\nc', [R(1, 0, 1, 2, 'ZZ')]), 'a\r\nZZ\r\nc')

console.log(fail ? `\n${fail} failed` : '\nall edit-applier checks passed')
process.exit(fail ? 1 : 0)
