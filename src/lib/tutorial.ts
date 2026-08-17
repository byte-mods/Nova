/**
 * The prompt behind the "Tutorial" button — the project-scale sibling of
 * `explain.ts`.
 *
 * `explain.ts` documents one file. This documents the *whole* application: the
 * libraries it stands on, the architecture, the patterns it instantiates, the
 * algorithms and data structures inside it, how it talks to a database, how a
 * user action travels from a click to the disk and back, and how it is built,
 * tested and shipped.
 *
 * Why it exists: a codebase assembled by an agent is readable line by line and
 * opaque as a system. Someone who arrives with only the prompt history knows
 * *what* was asked for and nothing about *why* the result is shaped this way —
 * which is exactly the knowledge you need to change it safely. So the contract
 * below is deliberately hostile to hand-waving:
 *
 *   - every structural claim must be backed by a real `path:line`
 *   - every technique must be named with the name a reader can go and search
 *   - every decision must be paired with the cost it accepts
 *   - "I could not find this in the repository" is a required, allowed answer
 *
 * The output is rendered as live Markdown with Mermaid, so the diagram rules are
 * the same strict ones the Explain contract uses — a malformed fence shows the
 * reader an error box instead of a diagram.
 */

import { MERMAID_RULES } from './explain'

export type TutorialChapterId =
  | 'tour'
  | 'stack'
  | 'architecture'
  | 'patterns'
  | 'algorithms'
  | 'data'
  | 'flows'
  | 'security'
  | 'pipeline'
  | 'book'

export interface TutorialChapter {
  id: TutorialChapterId
  /** Heading used in the generated document. */
  title: string
  /** Button label — short enough for a segmented control. */
  short: string
  /** Tooltip: what this chapter answers. */
  blurb: string
}

/**
 * The chapters, in reading order. `book` is last because it is all of them —
 * one long document rather than a chapter of its own.
 */
export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  {
    id: 'tour',
    title: 'Orientation — what this project is and where to start reading',
    short: 'Tour',
    blurb: 'What the app does, its map, and the order to read the files in',
  },
  {
    id: 'stack',
    title: 'The stack — every library and framework, and why it is here',
    short: 'Stack',
    blurb: 'Each dependency, the job it does, and what would break without it',
  },
  {
    id: 'architecture',
    title: 'Architecture — processes, layers and boundaries',
    short: 'Architecture',
    blurb: 'Process model, module layers, who is allowed to call whom',
  },
  {
    id: 'patterns',
    title: 'Design patterns actually used in this code',
    short: 'Patterns',
    blurb: 'The named patterns present here, each with the code that proves it',
  },
  {
    id: 'algorithms',
    title: 'Algorithms and data structures',
    short: 'Algorithms',
    blurb: 'The real algorithms inside, with complexity and why they were chosen',
  },
  {
    id: 'data',
    title: 'Data — persistence, schemas and queries',
    short: 'Data',
    blurb: 'What is stored, where, in what shape, and the queries that touch it',
  },
  {
    id: 'flows',
    title: 'Internal flows — from user action to result',
    short: 'Flows',
    blurb: 'End-to-end traces of the main operations, as sequence diagrams',
  },
  {
    id: 'security',
    title: 'Trust boundaries and the security model',
    short: 'Security',
    blurb: 'Where untrusted input enters and what stops it doing damage',
  },
  {
    id: 'pipeline',
    title: 'Build, test and release pipeline',
    short: 'Pipeline',
    blurb: 'How source becomes a running app, and what the test suites cover',
  },
  {
    id: 'book',
    title: 'The complete technical walkthrough',
    short: 'Everything',
    blurb: 'All chapters in one document — long, and the one to save into the repo',
  },
]

export function tutorialChapter(id: TutorialChapterId): TutorialChapter {
  return TUTORIAL_CHAPTERS.find((chapter) => chapter.id === id) ?? TUTORIAL_CHAPTERS[0]
}

/**
 * The rules that make the difference between a tutorial and a plausible-sounding
 * summary. They are repeated into every chapter because a single instruction at
 * the top of a long document stops being obeyed halfway down it.
 */
const GROUNDING = `
Ground rules — these are what make the document worth reading:

1. **Cite the code.** Every structural claim carries a \`path/to/file.ts:123\`
   reference. Open the file and read it before you cite it. If you cannot find
   evidence for something you expected to be here, write
   *"not present in this repository"* — that is a useful finding, not a failure.
2. **Never invent an API.** Quote identifiers exactly as they are spelled in the
   source. No illustrative-but-fictional function names, no libraries the project
   does not actually depend on.
3. **Name the concept.** When the code instantiates something with a canonical
   name — a pattern, an algorithm, a protocol, a complexity class, a consistency
   model — use that name, so the reader can go and study it independently of this
   codebase.
4. **Every decision has a price.** State what each choice costs: the case it
   handles badly, the scale it stops working at, the thing it gives up.
5. **Depth over coverage.** Ten claims that are true and specific beat forty that
   are vague. Skip filler, restatements of the obvious, and marketing tone.
6. **Write for someone who must change this code tomorrow**, not for someone
   deciding whether to be impressed by it.
`.trim()

/**
 * Per-chapter contracts. Written with `###` subheadings and no chapter number,
 * so the builder can number them 1..N in book mode and 1 on its own otherwise.
 */
const SECTIONS: Record<Exclude<TutorialChapterId, 'book'>, string> = {
  tour: `
Answer, in this order:

### What it is
One paragraph: the problem this application solves and who for. Then one
paragraph on the shape of the solution, so the rest of the document has a frame.

### The map
A table of every top-level directory: what lives there, and the one file inside
it worth reading first.

| Directory | Responsibility | Start with |

### The reading order
A numbered list of 8–12 files, in the order a newcomer should read them, each
with a sentence on what it teaches and what it assumes you already read. This is
the single most useful thing in the document — choose the files that carry the
design, not the biggest ones.

### The vocabulary
A table of the domain terms and type names this codebase uses in a specific way,
because these are what make reading the source confusing before you know them.

| Term | Defined in | What it means here |

### The one-diagram version
A single \`flowchart\` of the whole system at the coarsest useful grain.
`,

  stack: `
Read the manifest files (\`package.json\`, lockfile, and any other
dependency manifest) and the code that imports each entry.

### Runtime and language
The language version, the runtime, the module system, the type system settings
that actually change how code must be written — and where each is configured.

### Dependencies, one row each
Every production dependency. Do not skip the boring ones, and do not list
anything the project does not depend on.

| Library | Version | What it does here | Used in | What breaks without it |

Then the same table for development dependencies, grouped by purpose (build,
types, test, packaging).

### The frameworks, properly
For each *framework* (as opposed to library) pick out:
- the mental model it imposes on code written against it
- the specific framework features this project relies on, cited
- the seams where this project deliberately does not follow the framework's
  default way of doing things, and why

### What was chosen over what
The notable choices, and the alternative that was passed up. Where the source or
its comments state the reason, quote it; where they do not, reason from the code
and say clearly that you are inferring.

### The dependency budget
Which dependencies are load-bearing (removing them means a rewrite), which are
conveniences (a day's work to replace), and any that appear unused.
`,

  architecture: `
### The process and trust model
How many processes/threads/contexts run, what each is allowed to do, and how they
communicate. If there is a privileged side and an unprivileged side, say exactly
where the line is drawn and which file draws it.

### Layers
A table of the layers, top to bottom, with the rule about who may call whom —
and then any place in the code that violates that rule.

| Layer | Lives in | May call | Must never call |

### The contract between the layers
The typed boundary — the interfaces, message shapes or schemas that both sides
agree on. Name the file that owns the contract and explain what happens when the
two sides disagree.

### Diagrams
- a \`flowchart\` of the components and the direction data moves
- a \`sequenceDiagram\` of one request crossing every layer, from entry to reply
- a \`classDiagram\` of the core domain types and how they relate

${MERMAID_RULES}

### State: who owns what
Where each kind of state lives (in-memory, on disk, in a database, in the UI),
who is allowed to mutate it, and how the other parts find out that it changed.
Name the mechanism — subscription, event bus, polling, invalidation.

### Where this architecture strains
The change that would be hardest to make in this structure, and why.
`,

  patterns: `
Only patterns that are genuinely present. Do not pad the list, and do not rename
ordinary code into a pattern to make it sound designed.

For each one:

### <Pattern name>
- **The general idea** — two or three sentences, independent of this codebase.
- **Where it is here** — the file and line, and the code that makes it that
  pattern rather than something else.
- **What it buys this project** — the concrete problem it solves here.
- **What it costs** — the indirection, allocation, coupling or debugging
  difficulty accepted in exchange.

Cover, where they exist: creational patterns, structural patterns, behavioural
patterns, concurrency patterns, and architectural patterns (the bigger ones —
event-driven flow, ports and adapters, unidirectional data flow, CQRS,
plugin/extension host, and so on).

### Idioms particular to this codebase
The local conventions a reader must absorb: how errors are handled, how async
work is sequenced, how invalid states are made unrepresentable, how the code
signals refusal rather than guessing. Cite an example of each.

### Anti-patterns and known debt
Where the code repeats itself, leaks a boundary, or grows a type that carries too
much. Be specific and fair — cite the line, name the smell, say what it would
cost to fix and whether it is worth it.
`,

  algorithms: `
The real ones. Reading a file end to end and reporting "iterates over an array"
is not an algorithm; find the places where the *choice* of algorithm or data
structure is what makes the feature possible.

For each:

### <What it computes>
- **Where** — file and line.
- **The technique, named** — the canonical name, and the general statement of it.
- **The data structure it needs**, and why that one: what operation had to be
  cheap, and what got slower in exchange.
- **Complexity** — time and space, in the terms that matter here, with the input
  size it is actually run against.
- **Correctness** — the invariant it maintains, or the reason it is allowed to be
  approximate.
- **Failure mode** — the input that makes it slow or wrong.

Then:

### Data structures in play
| Structure | Where | Operations that must be fast | Cost accepted |

### Hot paths
Which code runs often enough for its complexity to matter, and how the project
keeps it cheap — caching, incremental recomputation, batching, debouncing,
memoisation, doing the work off the critical path. Cite each mechanism.

### Parsing, matching and traversal
If the project parses, tokenises, pattern-matches or walks a tree or graph,
explain the approach on its own terms: the grammar or shape assumed, what it
deliberately does not handle, and why a full parser was or was not used.

### Diagram
One \`flowchart\` of the most interesting algorithm as a state or phase machine.

${MERMAID_RULES}
`,

  data: `
If this project stores nothing, say so plainly in one paragraph, then cover
whatever persistence *does* exist — files, caches, settings, session state — with
the same rigour, and stop. Do not invent a database.

### What is stored, and where
| Data | Store | Format | Lifetime | Written by |

### The schema
The entities, their fields and their relationships. Include an \`erDiagram\` when
there are two or more related entities.

${MERMAID_RULES}

Then, for each entity: the primary key, the invariants that must hold, and the
field whose meaning is not obvious from its name.

### The queries
The actual statements this project runs — quoted from the source, with the file
they live in. For each: what it returns, which index or key it depends on, and
how it behaves as the table grows. Explain any join, aggregate, window function,
transaction boundary or isolation level that appears.

If queries are generated rather than written literally, explain the generator:
what it can express, what it refuses to express, and how it prevents injection.

### The database concepts a reader needs here
Only the ones this code actually depends on — name each and explain it in two
sentences, then point at the line where it matters. Candidates: transactions and
atomicity, isolation levels, indexes and index selectivity, normalisation and the
denormalisation this project chose, foreign keys and cascades, constraints,
migrations and their ordering, connection pooling, prepared statements,
optimistic vs pessimistic locking, eventual consistency, cache invalidation.

### Migration and compatibility
How a change to the shape of stored data is handled: what happens when an older
file or an older schema meets a newer build. If nothing handles it, say so — it
is the most common way this kind of application loses user data.
`,

  flows: `
Pick the four to six operations that matter most — the ones a reader will want to
change first. For each, trace it end to end through the real code.

Per flow:

### <Flow name>
1. **Trigger** — the exact UI element, command, event or entry point, cited.
2. **The path** — a numbered walk through every hop: function, file, line. Say
   what is validated, transformed or refused at each step.
3. **A \`sequenceDiagram\`** of that same path, with one participant per real
   component.
4. **The result** — what the user sees, what changed on disk or in memory, and
   what is broadcast so the rest of the app notices.
5. **When it goes wrong** — the failure modes, where each is caught, and what the
   user is told. Note anything that fails silently.
6. **The subtlety** — the one non-obvious thing in this flow: a race, an ordering
   requirement, a cache that must be invalidated, a cleanup that must run.

${MERMAID_RULES}

### Cross-cutting concerns
How these flows share the concerns that touch all of them: cancellation, retries,
timeouts, concurrency, error propagation, undo, logging, progress reporting. Cite
where each lives, and note any flow that skips one.
`,

  security: `Judge this project by its own threat model — the one implied by what it
does and where it runs — not by a generic checklist.

### The threat model
What an attacker could want here, and what channels reach the code: user input,
files on disk, network responses, subprocess output, plugins or extensions, and
any content rendered as markup or executed as code.

### Trust boundaries
| Boundary | Untrusted side | Enforced by | What crosses it |

Cite the file that enforces each one, and describe what an unchecked value would
be able to do if it got past.

### Handling of untrusted input
Walk the specific defences that exist in the code: validation, escaping,
sanitisation, allow-lists, argument arrays instead of shell strings, parameter
binding instead of string interpolation, path normalisation, size limits,
timeouts. Quote each one, and name the class of attack it stops.

### Secrets and sensitive data
What counts as a secret here, where it is stored, how it is protected at rest,
and every place it could be written to a log, an error message or the clipboard.

### Subprocesses and the outside world
Every process this app spawns and every network call it makes: what it trusts
about the response, and what happens if that process is missing, hostile, or
hangs.

### What is deliberately out of scope
The attacks this project does not defend against, and why that is a defensible
line to draw here. Then the gaps that are *not* defensible, ordered by how much
damage they allow.
`,

  pipeline: `
### From source to running app
The stages, in order, with the command and the config file that governs each:
dependency install, code generation, type checking, bundling, packaging, signing,
distribution. Say what each stage's output is and where it lands.

### The build configuration that matters
The handful of build settings that change how source must be written — module
format, path aliases, target environment, externals, asset handling, strictness
flags. Cite each and explain the consequence of changing it.

### Development loop
How a developer sees a change: what watches, what reloads, what does not, and the
change that requires a full restart.

### The test suites
| Suite | Command | What it actually asserts | What it cannot catch |

For each suite: how it isolates itself from the outside world, what it fakes, and
the class of bug it is designed to catch. Then the honest gap — the behaviour no
suite covers.

### Running it yourself
The exact commands, in order, from a clean clone to the app running and the tests
green, with the prerequisites each one assumes.

### Diagram
A \`flowchart\` of the pipeline from source to shipped artefact.

${MERMAID_RULES}
`,
}

const CLOSING = `
Close the document with:

### Build a small one yourself
A tutorial that reconstructs the *core idea* of this project from an empty
directory, in numbered steps. Each step: one sentence of intent, then a short
runnable snippet. Start with the crudest version that works and refine it, so the
reader arrives at understanding *why* the real code looks the way it does. This
is not a summary — it is the part where the reader earns the knowledge.

### Prove it to yourself
Three exercises against **this** repository, easy to hard. Each one names the
file to change, the change to make, and the observable result that confirms the
reader's model of the system was right. At least one must be a change that
*breaks* something in an instructive way.

### If you remember five things
Five sentences. The things that, if forgotten, would cause someone to make a
mess of this codebase.
`.trim()

export interface TutorialPromptOptions {
  /** Chapter to write, or `book` for all of them. */
  chapter: TutorialChapterId
  /** Directory name of the project root, used only to title the document. */
  projectName: string
}

export function buildTutorialPrompt(options: TutorialPromptOptions): string {
  const { chapter, projectName } = options
  const ids: Exclude<TutorialChapterId, 'book'>[] =
    chapter === 'book'
      ? (TUTORIAL_CHAPTERS.filter((c) => c.id !== 'book').map((c) => c.id) as Exclude<
          TutorialChapterId,
          'book'
        >[])
      : [chapter]

  const body = ids
    .map((id, index) => `## ${index + 1}. ${tutorialChapter(id).title}\n${SECTIONS[id].trim()}`)
    .join('\n\n---\n\n')

  const scope =
    chapter === 'book'
      ? `Document the **whole application**. This is a long document; budget your
reading. Survey the tree first, read the manifest and the entry points, then read
deeply in the modules that carry the design rather than skimming everything
equally.`
      : `Document **one aspect** of this application: ${tutorialChapter(chapter).blurb.toLowerCase()}.
Stay on that aspect. Read as much of the repository as you need to get it right,
but do not drift into the other chapters' territory.`

  return `You are writing the technical documentation for this repository that nobody
wrote while it was being built.

Your reader is a competent engineer who has never seen this codebase and who has
to make a change to it. They can read code. What they cannot do is recover the
reasoning: why these libraries, why this shape, what the invariants are, and
which parts will bite them. That is what you are producing.

PROJECT: ${projectName}

${scope}

Work from the actual source. Explore the tree, open files, follow imports and
call sites, read the tests, read the config. This is a **read-only** task: do not
create, edit, delete or move any file, and do not run anything that changes
state. Read-only commands that help you understand the project are welcome.

${GROUNDING}

Reply with GitHub-flavoured Markdown only — no preamble, no sign-off, no "here is
the document". Start at the first heading. Use exactly this structure:

# ${projectName}${chapter === 'book' ? ' — a technical walkthrough' : ''}

${body}

---

${CLOSING}

Write it so that a reader who finishes it can open a pull request against this
project without breaking anything. Be specific, be concrete, and prefer the
sentence that carries information over the sentence that sounds thorough.`
}

/** File name used by "Save into the project". */
export function tutorialFileName(chapter: TutorialChapterId): string {
  return chapter === 'book' ? 'TUTORIAL.md' : `TUTORIAL-${chapter}.md`
}
