import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  CodeReference,
  CodeSymbol,
  IndexStatus,
  ReferenceKind,
  SymbolKind,
} from '../../shared/types'
import { INDEXABLE_LANGUAGES, languageForPath } from '../../shared/languages'
import { BINARY_EXT, looksBinary, walk } from './scan'
import { COMMENT_PREFIXES } from './declarations'
import { parseSymbols } from './parseSymbols'

const MAX_FILES = 40_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** Upper bound on cached source text, so huge projects cannot exhaust memory. */
const CACHE_BUDGET_BYTES = 96 * 1024 * 1024
const MAX_REFERENCES = 5_000

/** How strongly each kind attracts a "go to definition" jump. */
const KIND_RANK: Record<SymbolKind, number> = {
  class: 10,
  interface: 10,
  struct: 10,
  trait: 10,
  enum: 9,
  type: 9,
  function: 8,
  method: 7,
  module: 6,
  macro: 6,
  constant: 5,
  variable: 4,
  property: 3,
  field: 3,
  selector: 2,
}

const IDENT_CHAR = /[A-Za-z0-9_$]/

export class ProjectIndex {
  root = ''
  ready = false
  indexing = false
  truncated = false
  durationMs = 0

  private byFile = new Map<string, CodeSymbol[]>()
  private byName = new Map<string, CodeSymbol[]>()
  private contents = new Map<string, string>()
  private cachedBytes = 0
  /** Every indexed file, including those too large to cache. */
  private files: string[] = []
  private generation = 0

  get fileCount() {
    return this.files.length
  }

  get symbolCount() {
    let total = 0
    for (const list of this.byFile.values()) total += list.length
    return total
  }

  status(): IndexStatus {
    return {
      root: this.root,
      ready: this.ready,
      indexing: this.indexing,
      files: this.fileCount,
      symbols: this.symbolCount,
      durationMs: this.durationMs,
      truncated: this.truncated,
    }
  }

  private clear() {
    this.byFile.clear()
    this.byName.clear()
    this.contents.clear()
    this.cachedBytes = 0
    this.files = []
    this.truncated = false
  }

  async build(root: string, onProgress: (status: IndexStatus) => void) {
    const generation = ++this.generation
    this.root = root
    this.indexing = true
    this.ready = false
    this.clear()
    onProgress(this.status())

    const started = Date.now()
    let processed = 0

    for await (const file of walk(root, MAX_FILES)) {
      if (generation !== this.generation) return // superseded by a newer build
      const language = languageForPath(file)
      if (!INDEXABLE_LANGUAGES.has(language)) continue
      if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue

      await this.ingest(file, language)
      processed++
      // Yield to the event loop regularly so IPC stays responsive.
      if (processed % 200 === 0) {
        onProgress(this.status())
        await new Promise((resolve) => setImmediate(resolve))
      }
    }

    if (generation !== this.generation) return
    this.truncated = this.files.length >= MAX_FILES
    this.durationMs = Date.now() - started
    this.indexing = false
    this.ready = true
    onProgress(this.status())
  }

  private async ingest(file: string, language: string) {
    let text: string
    try {
      const stat = await fs.stat(file)
      if (stat.size > MAX_FILE_BYTES) return
      const buf = await fs.readFile(file)
      if (looksBinary(buf)) return
      text = buf.toString('utf8')
    } catch {
      return
    }

    this.files.push(file)
    if (this.cachedBytes + text.length <= CACHE_BUDGET_BYTES) {
      this.contents.set(file, text)
      this.cachedBytes += text.length
    }

    const symbols = parseSymbols(file, language, text)
    if (symbols.length === 0) return
    this.byFile.set(file, symbols)
    for (const symbol of symbols) {
      const list = this.byName.get(symbol.name)
      if (list) list.push(symbol)
      else this.byName.set(symbol.name, [symbol])
    }
  }

  /** Re-parses a single file after an on-disk edit. */
  async refresh(file: string) {
    if (!this.root || !file.startsWith(this.root)) return
    const language = languageForPath(file)
    if (!INDEXABLE_LANGUAGES.has(language)) return

    this.evict(file)

    try {
      await fs.access(file)
    } catch {
      return // deleted; eviction above is the whole job
    }
    await this.ingest(file, language)
  }

  private evict(file: string) {
    const previous = this.byFile.get(file)
    if (previous) {
      for (const symbol of previous) {
        const list = this.byName.get(symbol.name)
        if (!list) continue
        const remaining = list.filter((s) => s.file !== file)
        if (remaining.length) this.byName.set(symbol.name, remaining)
        else this.byName.delete(symbol.name)
      }
      this.byFile.delete(file)
    }
    const cached = this.contents.get(file)
    if (cached !== undefined) {
      this.cachedBytes -= cached.length
      this.contents.delete(file)
    }
    const index = this.files.indexOf(file)
    if (index !== -1) this.files.splice(index, 1)
  }

  definitions(name: string, fromFile?: string): CodeSymbol[] {
    const candidates = this.byName.get(name) ?? []
    const fromLanguage = fromFile ? languageForPath(fromFile) : ''
    return [...candidates]
      .sort((a, b) => score(b) - score(a))
      .slice(0, 50)

    function score(symbol: CodeSymbol) {
      let value = KIND_RANK[symbol.kind] ?? 1
      if (fromFile && symbol.file === fromFile) value += 24
      if (fromLanguage && symbol.language === fromLanguage) value += 12
      if (symbol.exported) value += 6
      if (/(?:^|\/)(?:test|tests|spec|__tests__)\//.test(symbol.file)) value -= 8
      if (/\.(?:test|spec)\.[\w]+$/.test(symbol.file)) value -= 8
      return value
    }
  }

  documentSymbols(file: string): CodeSymbol[] {
    return this.byFile.get(file) ?? []
  }

  /**
   * Prefix completions drawn from the project's own declarations. This is what
   * makes class/function suggestions work for languages with no language
   * server installed — the index already knows every declaration in the tree.
   */
  completions(prefix: string, fromFile?: string, limit = 60): CodeSymbol[] {
    const needle = prefix.toLowerCase()
    const fromLanguage = fromFile ? languageForPath(fromFile) : ''
    const seen = new Map<string, { symbol: CodeSymbol; score: number }>()

    for (const [name, list] of this.byName) {
      if (needle && !name.toLowerCase().startsWith(needle)) continue
      for (const symbol of list) {
        let score = KIND_RANK[symbol.kind] ?? 1
        if (symbol.exported) score += 8
        if (fromLanguage && symbol.language === fromLanguage) score += 20
        if (fromFile && symbol.file === fromFile) score += 10
        // Prefer the shortest, most "canonical" declaration of a given name.
        const existing = seen.get(name)
        if (!existing || score > existing.score) seen.set(name, { symbol, score })
      }
      if (seen.size > 3000) break
    }

    return [...seen.values()]
      .sort((a, b) => b.score - a.score || a.symbol.name.length - b.symbol.name.length)
      .slice(0, limit)
      .map((entry) => entry.symbol)
  }

  workspaceSymbols(query: string, limit = 60): CodeSymbol[] {
    const needle = query.toLowerCase()
    const results: { symbol: CodeSymbol; score: number }[] = []
    for (const [name, list] of this.byName) {
      const lower = name.toLowerCase()
      let score = 0
      if (!needle) score = 1
      else if (lower === needle) score = 100
      else if (lower.startsWith(needle)) score = 70 - name.length
      else if (lower.includes(needle)) score = 40 - name.length
      else continue
      for (const symbol of list) {
        results.push({ symbol, score: score + (KIND_RANK[symbol.kind] ?? 0) })
      }
      if (results.length > 4000) break
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, limit).map((r) => r.symbol)
  }

  async references(name: string, fromFile?: string): Promise<CodeReference[]> {
    if (!name) return []
    const declarationLines = new Set(
      (this.byName.get(name) ?? []).map((s) => `${s.file}:${s.line}`),
    )
    const results: CodeReference[] = []

    for (const file of this.files) {
      if (results.length >= MAX_REFERENCES) break
      const text = await this.textOf(file)
      if (text === null || !text.includes(name)) continue

      const language = languageForPath(file)
      const commentPrefixes = COMMENT_PREFIXES[language] ?? []
      const lines = text.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.includes(name)) continue
        let from = 0
        for (;;) {
          const at = line.indexOf(name, from)
          if (at === -1) break
          from = at + name.length
          const before = at > 0 ? line[at - 1] : ''
          const after = at + name.length < line.length ? line[at + name.length] : ''
          if (IDENT_CHAR.test(before) || IDENT_CHAR.test(after)) continue

          results.push({
            file,
            line: i + 1,
            column: at + 1,
            preview: line.length > 300 ? `${line.slice(0, 300)}…` : line,
            kind: classify(line, at, commentPrefixes, declarationLines.has(`${file}:${i + 1}`)),
          })
          if (results.length >= MAX_REFERENCES) break
        }
        if (results.length >= MAX_REFERENCES) break
      }
    }

    results.sort((a, b) => {
      if (fromFile) {
        const aSame = a.file === fromFile ? 0 : 1
        const bSame = b.file === fromFile ? 0 : 1
        if (aSame !== bSame) return aSame - bSame
      }
      if (a.kind === 'declaration' !== (b.kind === 'declaration')) {
        return a.kind === 'declaration' ? -1 : 1
      }
      return a.file.localeCompare(b.file) || a.line - b.line
    })
    return results
  }

  private async textOf(file: string): Promise<string | null> {
    const cached = this.contents.get(file)
    if (cached !== undefined) return cached
    try {
      const buf = await fs.readFile(file)
      if (looksBinary(buf)) return null
      return buf.toString('utf8')
    } catch {
      return null
    }
  }
}

function classify(
  line: string,
  at: number,
  commentPrefixes: string[],
  isDeclaration: boolean,
): ReferenceKind {
  if (isDeclaration) return 'declaration'
  const trimmed = line.trimStart()
  if (commentPrefixes.some((prefix) => trimmed.startsWith(prefix))) return 'comment'
  if (/^\s*(?:import|from|require|use|using|include|#include|package|export\s+\*|export\s+\{)/.test(line)) {
    return 'import'
  }
  if (insideQuotes(line, at)) return 'string'
  return 'code'
}

/** Cheap odd-quote-count test; good enough to label a hit as string content. */
function insideQuotes(line: string, at: number) {
  let single = 0
  let double = 0
  let backtick = 0
  for (let i = 0; i < at; i++) {
    const ch = line[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === "'") single++
    else if (ch === '"') double++
    else if (ch === '`') backtick++
  }
  return single % 2 === 1 || double % 2 === 1 || backtick % 2 === 1
}
