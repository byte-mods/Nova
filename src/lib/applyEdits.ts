export interface TextEditLike {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  newText: string
}

/**
 * Applies LSP text edits to a string. Edits are sorted last-first so that
 * earlier offsets stay valid while rewriting, which is what the spec requires
 * of clients. Positions are line/character pairs, and a character past the end
 * of its line clamps to the line end.
 */
export class OverlappingEditsError extends Error {
  constructor() {
    super('The edits overlap and cannot be applied safely')
    this.name = 'OverlappingEditsError'
  }
}

export function applyEdits(text: string, edits: TextEditLike[]): string {
  if (edits.length === 0) return text

  const lineStarts = computeLineStarts(text)
  const offsetOf = (line: number, character: number) => {
    if (line < 0) return 0
    if (line >= lineStarts.length) return text.length
    const lineStart = lineStarts[line]
    // Clamp to the end of the line's *content*, before any line terminator,
    // so an out-of-range character never jumps past the newline.
    let lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] : text.length
    if (line + 1 < lineStarts.length) {
      if (text[lineEnd - 1] === '\n') lineEnd--
      if (text[lineEnd - 1] === '\r') lineEnd--
    }
    return Math.min(lineStart + character, lineEnd)
  }

  const resolved = edits
    .map((edit) => ({
      start: offsetOf(edit.range.start.line, edit.range.start.character),
      end: offsetOf(edit.range.end.line, edit.range.end.character),
      newText: edit.newText ?? '',
    }))
    .sort((a, b) => b.start - a.start || b.end - a.end)

  // Overlapping edits are invalid input. Applying them partially would silently
  // mangle the file, so refuse the whole document instead.
  for (let i = 0; i < resolved.length - 1; i++) {
    if (resolved[i + 1].end > resolved[i].start) throw new OverlappingEditsError()
  }

  let result = text
  for (const edit of resolved) {
    result = result.slice(0, edit.start) + edit.newText + result.slice(edit.end)
  }
  return result
}

function computeLineStarts(text: string) {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1)
  }
  return starts
}
