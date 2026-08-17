/**
 * The prompt behind the "Explain" button.
 *
 * The agent runs read-only in the project directory, so it can open imports,
 * follow call sites and read the tests before writing anything down — that is
 * the whole point of generating this from the repository rather than from the
 * single open buffer. The output contract is strict because the result is
 * rendered as live Markdown with Mermaid: a malformed diagram fence shows up
 * as an error box, not as prose.
 */

export type ExplainDepth = 'file' | 'system'

export interface ExplainPromptOptions {
  /** Path relative to the project root. */
  relativePath: string
  language: string
  depth: ExplainDepth
}

/**
 * Shared with the project-scale tutorial contract in `tutorial.ts`: both render
 * through the same Mermaid component, so both live under the same constraints.
 */
export const MERMAID_RULES = `
Rules for every \`\`\`mermaid block — they are rendered live, so a broken one is
visible to the reader:
- Use only: flowchart TD/LR, sequenceDiagram, classDiagram, stateDiagram-v2, erDiagram.
- Node labels must not contain parentheses, quotes, colons, or backticks. Write
  \`A[parse tokens]\`, never \`A[parse(tokens)]\`.
- Give every node a short id and label: \`idx[symbol index]\`.
- Keep each diagram under 15 nodes. Two focused diagrams beat one crowded one.
- Do not put Markdown inside a diagram.
`.trim()

export function buildExplainPrompt(options: ExplainPromptOptions): string {
  const { relativePath, language, depth } = options

  const scope =
    depth === 'system'
      ? `Read this file **and** the modules it imports, the code that calls it, and any
tests that exercise it. Explain it as a part of the wider system.`
      : `Focus on this file. Read its imports only far enough to describe its inputs
and outputs correctly.`

  return `You are writing a teaching document about one file in this repository, for a
competent engineer who has never seen this codebase.

TARGET FILE: ${relativePath}
LANGUAGE: ${language || 'unknown'}

${scope}

Work from the actual source. Open the file, follow what you need, and quote real
identifiers — never invent an API. This is a **read-only** task: do not create,
edit, delete or move any file, and do not run anything that changes state.

Reply with GitHub-flavoured Markdown only — no preamble, no sign-off, no "here
is the document". Start at the first heading. Use exactly these sections:

# <the file's name> — what it is and how it works

## 1. In one paragraph
What this file is responsible for and why it exists. Name the problem it solves.

## 2. The concept behind it
The theory a reader needs before the code makes sense: the algorithm, the
pattern, the protocol, the data structure — whatever this file is an instance
of. Explain the idea in general terms first, then say how this file realises it.
If there is a well-known name for the technique, name it.

## 3. How it works, step by step
Walk the main path in order. Refer to the real function and type names. Where a
decision is made, say what the alternatives were and which branch wins.

## 4. System design
Show the shape of it. At least two diagrams:
- a **flowchart** of the components and how data moves between them
- a **sequenceDiagram** of one complete operation from trigger to result
- add a **classDiagram** when the file defines types or classes, and an
  **erDiagram** when it models persisted data

${MERMAID_RULES}

## 5. The surface it exposes
A Markdown table of every exported/public function, type or constant:
| Name | Kind | Signature | What it is for |

## 6. Design decisions and trade-offs
The choices visible in the code, each with the cost it accepts. Include what the
file deliberately does *not* do.

## 7. Build it yourself
A tutorial that reconstructs the core idea from nothing, in numbered steps.
Each step: one sentence of intent, then a short runnable ${language || 'code'}
snippet. Start with the crudest version that works and refine it — the reader
should end up understanding *why* the real file looks the way it does.

## 8. Pitfalls, and three exercises
The mistakes someone would make here, then three concrete exercises against this
codebase, ordered easy to hard.

Aim for something a reader finishes in ten minutes and genuinely understands.
Be specific and concrete; skip filler.`
}

/** Turns the streamed document into a file name for "Save as Markdown". */
export function explainFileName(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? 'file'
  return `${base.replace(/\./g, '-')}.explained.md`
}

/**
 * Drops the conversational lead-in some CLIs emit before the document.
 *
 * Asking for "no preamble" gets you one anyway often enough to matter, and the
 * damage is worse than a stray sentence: arriving without a trailing newline it
 * glues itself to the first heading (`…structure.# orders.py`), which then
 * stops being a heading at all.
 *
 * The rule is structural rather than length-based, because the narration is
 * sometimes several sentences long: the document begins at its first heading,
 * so anything before that is narration — *unless* the prefix already contains
 * Markdown structure of its own, which would mean the heading found is not the
 * start of the document and nothing should be touched.
 */
export function cleanExplainMarkdown(raw: string): string {
  const match = /(?:^|\n|[.!?:)\]`])[ \t]*(#{1,6} +\S)/.exec(raw)
  if (!match) return raw
  const headingStart = match.index + match[0].length - match[1].length
  if (headingStart === 0) return raw

  const prefix = raw.slice(0, headingStart)
  // A fence, a table, a list or another heading means this is real content.
  if (/(^|\n)\s*(```|\||[-*+] |\d+\. |> |#)/.test(prefix)) return raw
  // Backstop: no plausible preamble runs for pages.
  if (prefix.length > 4000) return raw
  return raw.slice(headingStart)
}
