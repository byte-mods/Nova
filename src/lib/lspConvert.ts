import type * as monacoNs from 'monaco-editor'
import { monaco } from './monacoSetup'

/* ---------- LSP wire shapes (only the fields we consume) ---------- */

export interface LspPosition {
  line: number
  character: number
}
export interface LspRange {
  start: LspPosition
  end: LspPosition
}
export interface LspLocation {
  uri: string
  range: LspRange
}
export interface LspLocationLink {
  targetUri: string
  targetRange: LspRange
  targetSelectionRange?: LspRange
}
export interface LspTextEdit {
  range: LspRange
  newText: string
}

export function uriToPath(uri: string) {
  if (!uri.startsWith('file:')) return uri
  try {
    return decodeURIComponent(new URL(uri).pathname)
  } catch {
    return uri
  }
}

export function pathToUri(filePath: string) {
  return monaco.Uri.file(filePath).toString()
}

/** LSP is 0-based; Monaco is 1-based. */
export function toMonacoRange(range: LspRange): monacoNs.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

export function toLspPosition(position: monacoNs.IPosition): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function toLspRange(range: monacoNs.IRange): LspRange {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
  }
}

/** `Location`, `Location[]` and `LocationLink[]` all arrive on the same channel. */
export function toLocations(result: unknown): monacoNs.languages.Location[] {
  if (!result) return []
  const raw = Array.isArray(result) ? result : [result]
  const out: monacoNs.languages.Location[] = []
  for (const item of raw as (LspLocation & LspLocationLink)[]) {
    if (!item) continue
    if (typeof item.targetUri === 'string') {
      out.push({
        uri: monaco.Uri.file(uriToPath(item.targetUri)),
        range: toMonacoRange(item.targetSelectionRange ?? item.targetRange),
      })
    } else if (typeof item.uri === 'string') {
      out.push({ uri: monaco.Uri.file(uriToPath(item.uri)), range: toMonacoRange(item.range) })
    }
  }
  return out
}

/* ---------- diagnostics ---------- */

const SEVERITY: Record<number, monacoNs.MarkerSeverity> = {
  1: 8, // Error
  2: 4, // Warning
  3: 2, // Info
  4: 1, // Hint
}

export function toMarkers(diagnostics: any[]): monacoNs.editor.IMarkerData[] {
  return diagnostics.map((d) => ({
    ...toMonacoRange(d.range),
    message: d.message,
    severity: SEVERITY[d.severity ?? 1] ?? 8,
    code: d.code === undefined ? undefined : String(d.code),
    source: d.source,
  }))
}

/* ---------- completion ---------- */

/** LSP CompletionItemKind -> Monaco CompletionItemKind. */
const COMPLETION_KIND: Record<number, number> = {
  1: 0,   // Text
  2: 1,   // Method
  3: 2,   // Function
  4: 3,   // Constructor
  5: 4,   // Field
  6: 5,   // Variable
  7: 6,   // Class
  8: 8,   // Interface  (Monaco: 7=Struct, 8=Interface)
  9: 9,   // Module
  10: 10, // Property
  11: 12, // Unit -> Value
  12: 12, // Value
  13: 16, // Enum -> Enum
  14: 18, // Keyword
  15: 28, // Snippet
  16: 20, // Color
  17: 21, // File
  18: 22, // Reference
  19: 24, // Folder
  20: 17, // EnumMember
  21: 15, // Constant
  22: 7,  // Struct
  23: 11, // Event
  24: 13, // Operator
  25: 26, // TypeParameter
}

export function toCompletionItems(
  result: unknown,
  defaultRange: monacoNs.IRange,
): { items: monacoNs.languages.CompletionItem[]; incomplete: boolean } {
  const list = Array.isArray(result)
    ? { items: result, isIncomplete: false }
    : ((result ?? { items: [] }) as { items: any[]; isIncomplete?: boolean })
  const items = (list.items ?? []).map((item) => {
    const textEdit = item.textEdit
    const range: monacoNs.IRange = textEdit
      ? toMonacoRange(textEdit.range ?? textEdit.replace ?? textEdit.insert)
      : defaultRange
    const insertText: string = textEdit?.newText ?? item.insertText ?? item.label
    const isSnippet = item.insertTextFormat === 2

    return {
      label: item.label,
      kind: (COMPLETION_KIND[item.kind] ?? 0) as monacoNs.languages.CompletionItemKind,
      detail: item.detail,
      documentation: toMarkdown(item.documentation),
      sortText: item.sortText,
      filterText: item.filterText,
      preselect: item.preselect,
      insertText,
      insertTextRules: isSnippet ? 4 : undefined, // InsertAsSnippet
      range,
      commitCharacters: item.commitCharacters,
      additionalTextEdits: item.additionalTextEdits?.map((edit: LspTextEdit) => ({
        range: toMonacoRange(edit.range),
        text: edit.newText,
      })),
      tags: item.deprecated || item.tags?.includes(1) ? [1] : undefined,
      /** Kept so `resolveCompletionItem` can round-trip the original payload. */
      __lsp: item,
    } as monacoNs.languages.CompletionItem & { __lsp: unknown }
  })
  return { items, incomplete: Boolean(list.isIncomplete) }
}

export function toMarkdown(
  value: unknown,
): monacoNs.IMarkdownString | string | undefined {
  if (!value) return undefined
  if (typeof value === 'string') return { value, isTrusted: false }
  const record = value as { kind?: string; value?: string; language?: string }
  if (typeof record.value === 'string') {
    return record.kind === 'plaintext'
      ? { value: '```\n' + record.value + '\n```', isTrusted: false }
      : { value: record.value, isTrusted: false }
  }
  if (record.language && typeof record.value === 'string') {
    return { value: '```' + record.language + '\n' + record.value + '\n```', isTrusted: false }
  }
  return undefined
}

/* ---------- hover ---------- */

export function toHover(result: any): monacoNs.languages.Hover | null {
  if (!result?.contents) return null
  const contents = Array.isArray(result.contents) ? result.contents : [result.contents]
  const parts = contents
    .map((c: unknown) => toMarkdown(c))
    .filter(Boolean)
    .map((m: monacoNs.IMarkdownString | string) =>
      typeof m === 'string' ? { value: m } : m,
    ) as monacoNs.IMarkdownString[]
  if (parts.length === 0) return null
  return { contents: parts, range: result.range ? toMonacoRange(result.range) : undefined }
}

/* ---------- symbols ---------- */

/** LSP SymbolKind -> Monaco SymbolKind (both are 1-based-ish but differ by one). */
export function toMonacoSymbolKind(kind: number): number {
  return Math.max(0, (kind ?? 1) - 1)
}

export function toDocumentSymbols(result: any): monacoNs.languages.DocumentSymbol[] {
  if (!Array.isArray(result)) return []
  // Hierarchical DocumentSymbol[]
  if (result.length && 'selectionRange' in result[0]) {
    const walk = (nodes: any[]): monacoNs.languages.DocumentSymbol[] =>
      nodes.map((node) => ({
        name: node.name,
        detail: node.detail ?? '',
        kind: toMonacoSymbolKind(node.kind) as monacoNs.languages.SymbolKind,
        tags: [],
        range: toMonacoRange(node.range),
        selectionRange: toMonacoRange(node.selectionRange),
        children: node.children ? walk(node.children) : undefined,
      }))
    return walk(result)
  }
  // Flat SymbolInformation[]
  return result.map((node: any) => ({
    name: node.name,
    detail: node.containerName ?? '',
    kind: toMonacoSymbolKind(node.kind) as monacoNs.languages.SymbolKind,
    tags: [],
    range: toMonacoRange(node.location.range),
    selectionRange: toMonacoRange(node.location.range),
  }))
}

/* ---------- signature help ---------- */

export function toSignatureHelp(result: any): monacoNs.languages.SignatureHelp | null {
  if (!result?.signatures?.length) return null
  return {
    signatures: result.signatures.map((sig: any) => ({
      label: sig.label,
      documentation: toMarkdown(sig.documentation),
      parameters: (sig.parameters ?? []).map((p: any) => ({
        label: p.label,
        documentation: toMarkdown(p.documentation),
      })),
      activeParameter: sig.activeParameter,
    })),
    activeSignature: result.activeSignature ?? 0,
    activeParameter: result.activeParameter ?? 0,
  }
}
