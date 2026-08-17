/**
 * The breadcrumb bar: file path segments, then the symbol chain containing the
 * caret — `src › store.ts › OrderService › submit()`.
 *
 * Symbols come from the project index (or the language server when one is
 * running, via the same documentSymbols IPC the structure popup uses), so the
 * bar works on any indexable file with no tooling installed.
 */

import { useEffect, useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { CodeSymbol } from '@shared/types'
import { useStore } from '@/state/store'
import { relative } from '@/lib/paths'
import { symbolGlyph } from '@/lib/symbolGlyph'

export default function Breadcrumbs({ path }: { path: string }) {
  const root = useStore((s) => s.root) ?? ''
  const cursor = useStore((s) => s.cursor)
  const saved = useStore((s) => s.buffers[path]?.savedContent)
  const [symbols, setSymbols] = useState<CodeSymbol[]>([])

  useEffect(() => {
    let cancelled = false
    void window.nova.code.documentSymbols(path).then((result) => {
      if (!cancelled) setSymbols(result)
    })
    return () => {
      cancelled = true
    }
    // Re-fetched on save rather than each keystroke; the index parses on save.
  }, [path, saved])

  /**
   * The chain of symbols containing the caret line: the innermost declaration
   * at or above it, then its containers by name.
   */
  const chain = useMemo(() => {
    if (!cursor.line || symbols.length === 0) return []
    const enclosing = symbols
      .filter((symbol) => symbol.line <= cursor.line)
      .sort((a, b) => b.line - a.line)[0]
    if (!enclosing) return []
    const out: CodeSymbol[] = [enclosing]
    let container = enclosing.container
    let guard = 0
    while (container && guard++ < 6) {
      const parent = symbols
        .filter((symbol) => symbol.name === container && symbol.line <= out[0].line)
        .sort((a, b) => b.line - a.line)[0]
      if (!parent || out.includes(parent)) break
      out.unshift(parent)
      container = parent.container
    }
    return out
  }, [symbols, cursor.line])

  const segments = relative(root, path).split('/')

  return (
    <div className="breadcrumbs">
      {segments.map((segment, index) => (
        <span key={index} className="breadcrumb-seg">
          {index > 0 && <ChevronRight size={11} className="faint" />}
          <span className={index === segments.length - 1 ? '' : 'faint'}>{segment}</span>
        </span>
      ))}
      {chain.map((symbol) => (
        <span key={`${symbol.name}:${symbol.line}`} className="breadcrumb-seg">
          <ChevronRight size={11} className="faint" />
          <button
            className="breadcrumb-symbol"
            title={symbol.signature}
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('nova:goto-line', {
                  detail: { path, line: symbol.line, column: symbol.column },
                }),
              )
            }
          >
            <span style={{ fontSize: 10, color: symbolGlyph(symbol.kind).color }}>
              {symbolGlyph(symbol.kind).glyph}
            </span>
            {symbol.name}
          </button>
        </span>
      ))}
    </div>
  )
}
