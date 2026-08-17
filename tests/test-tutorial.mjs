/**
 * The pure half of the project Tutorial feature: the prompt contract.
 *
 * The contract is the feature. A chapter that quietly stops asking for citations
 * or for the cost of a decision still produces a document that reads fine and
 * teaches nothing, and no runtime check would catch it — so the guarantees are
 * asserted here, per chapter.
 */
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const { TUTORIAL_CHAPTERS, buildTutorialPrompt, tutorialChapter, tutorialFileName } = await import(
  pathToFileURL(`${BUILD}/tutorial.js`).href
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

/* ---------------- the chapter list ---------------- */

const ids = TUTORIAL_CHAPTERS.map((chapter) => chapter.id)

check(
  'every chapter the UI offers builds a prompt asking for its own section',
  TUTORIAL_CHAPTERS.every((chapter) =>
    buildTutorialPrompt({ chapter: chapter.id, projectName: 'Nova' }).includes(
      chapter.id === 'book' ? '## 9. ' : `## 1. ${chapter.title}`,
    ),
  ),
)
check(
  'the title is stated once — the H1 names the project, the H2 names the chapter',
  (() => {
    const prompt = buildTutorialPrompt({ chapter: 'data', projectName: 'Nova' })
    const title = tutorialChapter('data').title
    return prompt.includes('# Nova\n') && prompt.split(title).length - 1 === 1
  })(),
)
check('the chapter list is unique', new Set(ids).size === ids.length)
check('the full book is the last entry, so it sorts after its chapters', ids.at(-1) === 'book')
check(
  'every chapter carries a label and a tooltip',
  TUTORIAL_CHAPTERS.every((c) => c.title && c.short && c.blurb),
)
check(
  'the segmented labels stay short enough to fit the rail',
  TUTORIAL_CHAPTERS.every((c) => c.short.length <= 13),
  TUTORIAL_CHAPTERS.filter((c) => c.short.length > 13)
    .map((c) => c.short)
    .join(', '),
)
check('an unknown chapter id falls back rather than throwing', tutorialChapter('nope').id === 'tour')

/* ---------------- every chapter, every time ---------------- */

for (const id of ids) {
  const prompt = buildTutorialPrompt({ chapter: id, projectName: 'Nova' })
  const label = `[${id}]`

  check(`${label} names the project`, prompt.includes('Nova'))
  check(
    `${label} demands a path:line citation for structural claims`,
    /path\/to\/file\.ts:123/.test(prompt),
  )
  check(
    `${label} allows "not present in this repository" as an answer`,
    prompt.includes('not present in this repository'),
  )
  check(`${label} forbids inventing an API`, /Never invent an API/.test(prompt))
  check(`${label} requires the cost of each decision`, /Every decision has a price/.test(prompt))
  check(
    `${label} forbids writes, so a document cannot edit its subject`,
    /read-only/i.test(prompt) && /do not\ncreate, edit, delete or move any file/.test(prompt),
  )
  check(`${label} ends with the build-it-yourself tutorial`, prompt.includes('Build a small one yourself'))
  check(`${label} ends with exercises against this repository`, prompt.includes('Prove it to yourself'))
  check(`${label} suppresses the conversational preamble`, prompt.includes('no preamble'))
  check(
    `${label} numbers its sections from 1`,
    prompt.includes('## 1. '),
  )
}

/* ---------------- chapter-specific content ---------------- */

const stack = buildTutorialPrompt({ chapter: 'stack', projectName: 'Nova' })
check(
  'the stack chapter asks what breaks without each dependency',
  stack.includes('What breaks without it') && stack.includes('development dependencies'),
)

const architecture = buildTutorialPrompt({ chapter: 'architecture', projectName: 'Nova' })
check(
  'the architecture chapter asks for the layering rule and its violations',
  architecture.includes('Must never call') && /violates that rule/.test(architecture),
)
check(
  'the architecture chapter asks for a flowchart, a sequence and a class diagram',
  ['flowchart', 'sequenceDiagram', 'classDiagram'].every((kind) => architecture.includes(kind)),
)

const patterns = buildTutorialPrompt({ chapter: 'patterns', projectName: 'Nova' })
check(
  'the patterns chapter refuses padding',
  /Do not pad the list/.test(patterns) && patterns.includes('Anti-patterns'),
)

const algorithms = buildTutorialPrompt({ chapter: 'algorithms', projectName: 'Nova' })
check(
  'the algorithms chapter asks for complexity and the failing input',
  algorithms.includes('Complexity') && algorithms.includes('Failure mode'),
)

const data = buildTutorialPrompt({ chapter: 'data', projectName: 'Nova' })
check(
  'the data chapter asks for real queries and an ER diagram',
  data.includes('erDiagram') && /quoted from the source/.test(data),
)
check(
  'the data chapter refuses to invent a database when there is none',
  /Do not invent a database/.test(data),
)
check(
  'the data chapter names the DB concepts a reader needs',
  ['transactions', 'isolation levels', 'indexes', 'normalisation', 'prepared statements'].every((term) =>
    data.includes(term),
  ),
)

const flows = buildTutorialPrompt({ chapter: 'flows', projectName: 'Nova' })
check(
  'the flows chapter asks for an end-to-end trace and its failure modes',
  flows.includes('sequenceDiagram') && flows.includes('fails silently'),
)

const security = buildTutorialPrompt({ chapter: 'security', projectName: 'Nova' })
check(
  'the security chapter asks for trust boundaries and what is out of scope',
  security.includes('Trust boundaries') && security.includes('deliberately out of scope'),
)

const pipeline = buildTutorialPrompt({ chapter: 'pipeline', projectName: 'Nova' })
check(
  'the pipeline chapter asks what the suites cannot catch',
  pipeline.includes('What it cannot catch') && pipeline.includes('Running it yourself'),
)

/* ---------------- the book ---------------- */

const book = buildTutorialPrompt({ chapter: 'book', projectName: 'Nova' })
const chapterCount = TUTORIAL_CHAPTERS.length - 1

check(
  'the book contains every chapter, numbered in reading order',
  Array.from({ length: chapterCount }, (_, i) => `## ${i + 1}. `).every((h) => book.includes(h)) &&
    !book.includes(`## ${chapterCount + 1}. `),
)
check(
  'the book repeats the mermaid label constraint that breaks the parser',
  book.includes('must not contain parentheses'),
)
check(
  'the book warns the agent to budget its reading',
  /budget your\nreading/.test(book),
)
check('a single chapter is much shorter than the book', book.length > stack.length * 2)
check(
  'a single chapter is told to stay on its own aspect',
  /do not drift into the other chapters/.test(stack),
)

/* ---------------- saved file names ---------------- */

check('the book saves as TUTORIAL.md', tutorialFileName('book') === 'TUTORIAL.md')
check('a chapter saves under its own name', tutorialFileName('data') === 'TUTORIAL-data.md')

console.log(`\ntutorial: ${passed}/${passed + failed} passed`)
if (failed) process.exit(1)
