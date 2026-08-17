/**
 * Builds the context block that goes in front of every prompt.
 *
 * The agent runs with the project as its working directory and can read
 * anything it wants, so this is not about *supplying* the code — it is about
 * orienting it. What the user is looking at right now is the single most useful
 * thing to say, and it is the one thing the agent cannot discover on its own.
 *
 * Kept deliberately compact. A long preamble competes with the user's actual
 * question for attention, and a file tree of five thousand entries is noise.
 */
import { useStore } from '@/state/store'
import { relative } from '@/lib/paths'
import { languageForPath } from '@/lib/language'

/** Lines of the active file to include around the caret when nothing is selected. */
const CARET_WINDOW = 40
/** Hard cap on included source, so a huge file cannot swamp the prompt. */
const MAX_SNIPPET_CHARS = 6000

export interface EditorContext {
  root: string | null
  activeFile: string | null
  language: string
  selection: string
  caretLine: number
  openFiles: string[]
}

export function collectEditorContext(): EditorContext {
  const state = useStore.getState()
  const tab = state.tabs.find((t) => t.id === state.activeTabId)
  const activeFile = tab?.kind === 'file' || tab?.kind === 'diagram' ? (tab.path ?? null) : null

  return {
    root: state.root,
    activeFile,
    language: activeFile ? languageForPath(activeFile) : '',
    selection: '',
    caretLine: state.cursor.line,
    openFiles: state.tabs
      .filter((t) => t.kind === 'file' && t.path)
      .map((t) => t.path!)
      .slice(0, 20),
  }
}

/**
 * Renders the context block.
 *
 * Returns an empty string when there is nothing worth saying, so a prompt asked
 * with no project open is not decorated with empty headings.
 */
export function buildContextBlock(options: { includeSelection: boolean } = { includeSelection: true }): string {
  const state = useStore.getState()
  const context = collectEditorContext()
  if (!context.root) return ''

  const lines: string[] = []

  if (context.openFiles.length) {
    const list = context.openFiles.map((file) => `- ${relative(context.root!, file)}`).join('\n')
    lines.push(`Files currently open in the editor:\n${list}`)
  }

  if (context.activeFile) {
    const rel = relative(context.root, context.activeFile)
    lines.push(`The user is looking at **${rel}** (${context.language || 'unknown'}), caret on line ${context.caretLine}.`)

    if (options.includeSelection) {
      const buffer = state.buffers[context.activeFile]
      const snippet = buffer && !buffer.binary ? windowAround(buffer.content, context.caretLine) : ''
      if (snippet) {
        lines.push(
          `The part of that file around the caret:\n\`\`\`${context.language}\n${snippet}\n\`\`\`\n` +
            `Read the whole file rather than relying on this excerpt if you need more.`,
        )
      }
    }
  }

  if (!lines.length) return ''

  return `<editor-context>\n${lines.join('\n\n')}\n</editor-context>\n\n`
}

/**
 * Extracts the lines around the caret, snapped to whole lines.
 *
 * A window rather than the whole file: the agent can open the file itself, and
 * pasting two thousand lines into every prompt is both slow and worse — the
 * relevant part gets buried.
 */
function windowAround(content: string, caretLine: number): string {
  const lines = content.split('\n')
  if (lines.length <= CARET_WINDOW) return truncate(content)

  const centre = Math.max(1, Math.min(caretLine || 1, lines.length))
  const start = Math.max(0, centre - Math.floor(CARET_WINDOW / 2))
  const end = Math.min(lines.length, start + CARET_WINDOW)
  // Number the lines so the agent can refer to them precisely.
  return truncate(
    lines
      .slice(start, end)
      .map((line, i) => `${String(start + i + 1).padStart(5)}  ${line}`)
      .join('\n'),
  )
}

function truncate(text: string): string {
  return text.length > MAX_SNIPPET_CHARS ? `${text.slice(0, MAX_SNIPPET_CHARS)}\n… truncated …` : text
}
