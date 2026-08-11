import type { SymbolKind } from '@shared/types'

/** Compact letter badges for symbol kinds, in the spirit of IntelliJ's gutter icons. */
const GLYPHS: Record<SymbolKind, { glyph: string; color: string }> = {
  class: { glyph: 'C', color: '#e0af68' },
  interface: { glyph: 'I', color: '#7dcfff' },
  struct: { glyph: 'S', color: '#e0af68' },
  trait: { glyph: 'T', color: '#7dcfff' },
  enum: { glyph: 'E', color: '#bb9af7' },
  type: { glyph: 'T', color: '#bb9af7' },
  function: { glyph: 'ƒ', color: '#9ece6a' },
  method: { glyph: 'm', color: '#9ece6a' },
  module: { glyph: 'M', color: '#6ea8fe' },
  macro: { glyph: '#', color: '#f7768e' },
  constant: { glyph: 'k', color: '#ff9e64' },
  variable: { glyph: 'v', color: '#a0aec0' },
  property: { glyph: 'p', color: '#7dcfff' },
  field: { glyph: 'f', color: '#7dcfff' },
  selector: { glyph: '.', color: '#f7768e' },
}

export function symbolGlyph(kind: SymbolKind) {
  return GLYPHS[kind] ?? { glyph: '?', color: 'var(--text-muted)' }
}
