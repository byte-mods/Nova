import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

/**
 * Semantic highlighting: the classifier that colours function and type names,
 * and the relative encoding both sources emit.
 *
 * The encoding cases matter as much as the classification ones — a delta that
 * is off by one paints the whole rest of the file in the wrong colours, and
 * looks like a theme bug rather than an arithmetic one.
 */
const { classifyUnclassified, classifyWord, remapServerTokens, TYPE_INDEX } = await import(
  pathToFileURL(`${BUILD}/semanticClassify.js`).href
)

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a === b) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}\n        expected ${b}\n        got      ${a}`)
  }
}

const type = (name) => TYPE_INDEX.get(name)

/* ---------------- classification ---------------- */

/** `word` is the identifier under test; `line` is the source line it sits in. */
function classifyIn(line, word) {
  const start = line.indexOf(word)
  const result = classifyWord(word, line, start, start + word.length)
  if (result === null) return null
  for (const [name, index] of TYPE_INDEX) if (index === result) return name
  return null
}

const CASES = [
  // A name being called, which is the one shape every language shares.
  ['a call', 'total = computeTotal(items)', 'computeTotal', 'function'],
  ['a method call', 'const n = repo.findAll()', 'findAll', 'method'],
  ['a call with a space', 'value = compute (x)', 'compute', 'function'],

  // Declarations, by the keyword that introduces them.
  ['a js function', 'export function legacyFormat(m) {', 'legacyFormat', 'function'],
  ['a python def', 'def create_order(self, total):', 'create_order', 'function'],
  ['a go func', 'func handleRequest(w, r) {', 'handleRequest', 'function'],
  ['a rust fn', 'pub fn parse_config(path: &str) {', 'parse_config', 'function'],
  ['an elixir defp', 'defp normalize(value) do', 'normalize', 'function'],

  ['a class', 'class OrderService extends Base {', 'OrderService', 'class'],
  ['a go struct', 'type orderRepo struct {', 'orderRepo', 'class'],
  ['an interface', 'public interface auditable {', 'auditable', 'class'],
  ['a rust trait', 'pub trait renderable {', 'renderable', 'class'],

  // `new Foo()` is a type, even though a paren follows it.
  ['a constructor', 'const s = new OrderService(db)', 'OrderService', 'class'],

  // Convention: a capitalised leftover is a type.
  ['a capitalised name', 'let repo: OrderRepo = init', 'OrderRepo', 'class'],
  // ...but after a dot it is a field, which Go spells with a capital too.
  ['an exported field', 'subtotal += item.Price', 'Price', 'property'],
  // The cost of that rule: a package-qualified type reads as a field too.
  // Field access is far more common than qualified types, and a language
  // server — where one exists — gets both right anyway.
  ['a qualified type, the known trade-off', 'var r = billing.OrderRepo', 'OrderRepo', 'property'],

  // Things that must be left alone.
  ['a plain variable', 'const total = subtotal + tax', 'subtotal', null],
  ['a control keyword', 'if (ready) {', 'if', null],
  ['a for loop', 'for (i = 0; i < n; i++) {', 'for', null],
  ['a while loop', 'while (queue.length) {', 'while', null],
  ['a switch', 'switch (kind) {', 'switch', null],
  ['a catch', '} catch (err) {', 'catch', null],
  // A single capital is a loop variable or a generic far more often than a type.
  ['a single capital', 'for (T x : items) {', 'T', null],
  ['a screaming constant', 'const MAX_ITEMS = 50', 'MAX_ITEMS', null],
]

for (const [label, line, word, expected] of CASES) {
  check(label, classifyIn(line, word), expected)
}

/* ---------------- encoding ---------------- */

// Two names on one line, then one on a later line: the second token's delta is
// relative to the first, and the third resets the column because the line moved.
const encoded = classifyUnclassified([
  { text: 'const a = compute(load())', ranges: [{ start: 0, end: 25 }] },
  { text: '', ranges: [] },
  { text: 'class OrderRepo {', ranges: [{ start: 0, end: 17 }] },
])

check('encodes two tokens on a line and one below', encoded, [
  // deltaLine, deltaStart, length, type, modifiers
  0, 10, 7, type('function'), 0,
  0, 8, 4, type('function'), 0,
  2, 6, 9, type('class'), 0,
])

/* ---------------- remapping a server's legend ---------------- */

// A server whose legend is in its own order, including a type Nova does not
// paint (`comment` is fine, `punctuation` is not) and one of rust-analyzer's
// extensions (`builtinType`).
const legend = {
  tokenTypes: ['punctuation', 'function', 'builtinType', 'variable'],
  tokenModifiers: ['declaration', 'readonly'],
}

check(
  'remaps a server legend onto Nova indices',
  remapServerTokens([0, 4, 3, 1, 1, 0, 5, 6, 3, 0], legend),
  [0, 4, 3, type('function'), 0, 0, 5, 6, type('variable'), 0],
)

check(
  'folds a server extension onto the closest painted type',
  remapServerTokens([1, 2, 5, 2, 0], legend),
  [1, 2, 5, type('type'), 0],
)

// The dropped token's deltas belong to the one after it. Here `punctuation`
// (index 0) is dropped from the middle of a line, so the surviving token must
// end up at column 4 + 6 = 10, not 6.
check(
  'carries the deltas of a dropped token',
  remapServerTokens([0, 4, 1, 0, 0, 0, 6, 3, 1, 0], legend),
  [0, 10, 3, type('function'), 0],
)

// Same, but the dropped token is the first on a new line — the survivor's
// column is absolute rather than relative, because the line changed.
check(
  'resets the column when a dropped token changed line',
  remapServerTokens([2, 4, 1, 0, 0, 0, 6, 3, 1, 0], legend),
  [2, 10, 3, type('function'), 0],
)

check('ignores a truncated trailing group', remapServerTokens([0, 4, 3, 1], legend), [])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
