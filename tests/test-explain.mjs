/** The pure half of the Explain feature: the prompt contract and the cleanup. */
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const { buildExplainPrompt, cleanExplainMarkdown, explainFileName } = await import(
  pathToFileURL(`${BUILD}/explain.js`).href
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

/* ---------------- the prompt ---------------- */

const prompt = buildExplainPrompt({
  relativePath: 'src/orders.py',
  language: 'python',
  depth: 'system',
})

check('names the target file and language', prompt.includes('src/orders.py') && prompt.includes('python'))
check(
  'asks for all eight sections',
  ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.', '## 8.'].every((h) => prompt.includes(h)),
)
check(
  'demands diagrams, theory and a tutorial',
  prompt.includes('flowchart') && prompt.includes('sequenceDiagram') && prompt.includes('Build it yourself'),
)
check(
  'states the mermaid label constraint that breaks the parser',
  prompt.includes('must not contain parentheses'),
)
check(
  'forbids writes, so a walkthrough cannot edit its subject',
  /read-only/i.test(prompt) && /do not create,\s+edit, delete or move any file/.test(prompt),
)

const shallow = buildExplainPrompt({ relativePath: 'a.ts', language: 'typescript', depth: 'file' })
check('the file-only depth does not ask for callers', !shallow.includes('the code that calls it'))
check('the system depth does', prompt.includes('the code that calls it'))

/* ---------------- the cleanup ---------------- */

check(
  'a glued preamble is removed and the heading survives',
  cleanExplainMarkdown("I'll trace the file, then write it up.# orders.py\n\n## 1. In one paragraph\n") ===
    '# orders.py\n\n## 1. In one paragraph\n',
  cleanExplainMarkdown("I'll trace the file.# orders.py\n"),
)

check(
  'a preamble on its own line is removed',
  cleanExplainMarkdown('Sure, here you go:\n# Title\n\nbody\n') === '# Title\n\nbody\n',
)

check(
  'a document that already starts with its heading is untouched',
  cleanExplainMarkdown('# Title\n\nbody\n') === '# Title\n\nbody\n',
)

check(
  'a multi-sentence narration is removed too — length is not the signal',
  cleanExplainMarkdown(
    "I'm tracing src/main.py outward through imports and tests.The repository " +
      'has one entry point, so I will start there and work outward.\n\n## 1. In one paragraph\nbody\n',
  ) === '## 1. In one paragraph\nbody\n',
)

const withList = 'Intro line.\n\n- a bullet\n\n# Title\n'
check('a prefix containing Markdown structure is kept', cleanExplainMarkdown(withList) === withList)

const withFence = 'Intro.\n\n```js\nconst a = 1\n```\n\n# Title\n'
check('a prefix containing a code fence is kept', cleanExplainMarkdown(withFence) === withFence)

const huge = `${'x'.repeat(5000)}\n# Title\n`
check('an implausibly long prefix is kept as a backstop', cleanExplainMarkdown(huge) === huge)

check('content with no heading at all is passed through', cleanExplainMarkdown('just prose') === 'just prose')

check(
  'a hash that is not a heading is ignored',
  cleanExplainMarkdown('count is #5 today') === 'count is #5 today',
)

/* ---------------- misc ---------------- */

check('the saved file name is derived from the source', explainFileName('src/orders.py') === 'orders-py.explained.md')

console.log(`\nexplain: ${passed}/${passed + failed} passed`)
if (failed) process.exit(1)
