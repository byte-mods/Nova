/**
 * Encapsulate Field, Invert Boolean, Inline Parameter and Inline Field.
 *
 * These four share a shape: each rewrites a declaration *and* every place that
 * reads it, which is only safe when the engine can enumerate those places. So
 * each one starts by collecting occurrences the same way Rename does — masked
 * text, identifier boundaries, index-driven file list — and refuses when the
 * set it found does not look complete (a compound assignment it cannot invert,
 * call sites whose argument lists do not line up, a field written from more
 * than one place).
 */

import { languageForPath } from '../../../shared/languages'
import { analyze, isFailure, parenthesizeIfNeeded, type RefactorContext } from './context'
import { findCallSites, parseParams } from './params'
import {
  allClasses,
  allFunctions,
  indentOf,
  lineRange,
  occurrences,
  statementLines,
  wordAtOffset,
  type Declaration,
} from './syntax'
import {
  fail,
  fileEdit,
  succeed,
  type RefactorResult,
  type RefactorSite,
  type RefactorWorkspace,
  type TextEdit,
} from './types'

const ZERO_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

/* ---------------- shared helpers ---------------- */

/** The `not` operator, spelled the way the language spells it. */
function notOperator(languageId: string): { prefix: string; wrap: (expr: string) => string } {
  if (languageId === 'python') return { prefix: 'not ', wrap: (e) => `not (${e})` }
  if (languageId === 'ruby') return { prefix: '!', wrap: (e) => `!(${e})` }
  return { prefix: '!', wrap: (e) => `!(${e})` }
}

const COMPARISON_FLIPS: [RegExp, string][] = [
  [/\s===\s/, ' !== '],
  [/\s!==\s/, ' === '],
  [/\s==\s/, ' != '],
  [/\s!=\s/, ' == '],
  [/\s>=\s/, ' < '],
  [/\s<=\s/, ' > '],
  [/\s>\s/, ' <= '],
  [/\s<\s/, ' >= '],
]

/** Logical negation that stays readable: flips comparisons, cancels a leading not. */
export function negate(expression: string, languageId: string): string {
  const trimmed = expression.trim()
  if (!trimmed) return trimmed
  const not = notOperator(languageId)

  if (trimmed === 'true') return 'false'
  if (trimmed === 'false') return 'true'
  if (trimmed === 'True') return 'False'
  if (trimmed === 'False') return 'True'

  if (languageId === 'python' && /^not\s+/.test(trimmed)) return trimmed.replace(/^not\s+/, '')
  if (/^!\s*/.test(trimmed) && languageId !== 'python') return trimmed.replace(/^!\s*/, '')
  if (/^!?\(.*\)$/.test(trimmed) && trimmed.startsWith('!(')) return trimmed.slice(2, -1)

  // Only flip a comparison when it is the whole expression, i.e. there is no
  // top-level `&&`/`||` that would need De Morgan.
  if (!/(\|\||&&|\band\b|\bor\b)/.test(trimmed)) {
    for (const [pattern, replacement] of COMPARISON_FLIPS) {
      if (pattern.test(trimmed)) return trimmed.replace(pattern, replacement)
    }
  }

  if (/^[\w$.]+(\([^()]*\))?$/.test(trimmed)) return `${not.prefix}${trimmed}`
  return not.wrap(trimmed)
}

/** The field-ish declaration line the caret sits on, inside a class. */
function fieldAt(ctx: RefactorContext): { name: string; line: number; cls: Declaration } | null {
  if (!ctx.cls) return null
  const caretLine = ctx.lineOf(ctx.start)
  if (caretLine <= ctx.cls.line || caretLine > ctx.cls.endLine) return null
  const word = wordAtOffset(ctx.text, ctx.start)
  const line = ctx.lines[caretLine]
  const declared =
    /^(?:\s*(?:public|private|protected|internal|static|final|readonly|val|var|let|const|pub)\s+)*(?:[\w.<>\[\]]+\s+)?[$@]?([A-Za-z_][\w$]*)\s*[:=;]/.exec(
      line,
    )
  const name = word?.name && line.includes(word.name) ? word.name : declared?.[1]
  if (!name) return null
  return { name, line: caretLine, cls: ctx.cls }
}

/* ================================================================== */
/* Encapsulate Field                                                   */
/* ================================================================== */

interface AccessorShape {
  getterName: (field: string) => string
  setterName: (field: string) => string
  getter: (parts: AccessorParts) => string[]
  setter: (parts: AccessorParts) => string[]
  /** Python properties keep call sites reading `obj.field`. */
  transparent: boolean
  /** Renames the storage, e.g. Python's `_value`. */
  backingField?: (field: string) => string
  /** Makes the declaration private, when the language has visibility keywords. */
  privatize: (line: string) => string
}

interface AccessorParts {
  field: string
  backing: string
  type: string
  receiver: string
}

const KEEP = (line: string) => line
const MAKE_PRIVATE = (line: string) => {
  if (/\b(private|protected)\b/.test(line)) return line
  const indent = indentOf(line)
  const body = line.slice(indent.length).replace(/^public\s+/, '')
  return `${indent}private ${body}`
}

function cap(value: string) {
  return value.replace(/^_+/, '').replace(/^./, (c) => c.toUpperCase())
}

/** One entry per language that has a idiomatic accessor pair worth generating. */
function accessorShape(languageId: string): AccessorShape | null {
  const id = languageId.replace(/react$/, '')
  switch (id) {
    case 'typescript':
      return {
        getterName: (f) => `get${cap(f)}`,
        setterName: (f) => `set${cap(f)}`,
        getter: (p) => [`get${cap(p.field)}()${p.type ? `: ${p.type}` : ''} {`, `  return this.${p.backing}`, '}'],
        setter: (p) => [`set${cap(p.field)}(value${p.type ? `: ${p.type}` : ''}) {`, `  this.${p.backing} = value`, '}'],
        transparent: false,
        privatize: MAKE_PRIVATE,
      }
    case 'javascript':
      return {
        getterName: (f) => `get${cap(f)}`,
        setterName: (f) => `set${cap(f)}`,
        getter: (p) => [`get${cap(p.field)}() {`, `  return this.${p.backing}`, '}'],
        setter: (p) => [`set${cap(p.field)}(value) {`, `  this.${p.backing} = value`, '}'],
        transparent: false,
        privatize: KEEP,
      }
    case 'java':
      return {
        getterName: (f) => `get${cap(f)}`,
        setterName: (f) => `set${cap(f)}`,
        getter: (p) => [`public ${p.type || 'Object'} get${cap(p.field)}() {`, `    return this.${p.backing};`, '}'],
        setter: (p) => [
          `public void set${cap(p.field)}(${p.type || 'Object'} value) {`,
          `    this.${p.backing} = value;`,
          '}',
        ],
        transparent: false,
        privatize: MAKE_PRIVATE,
      }
    case 'csharp':
      return {
        getterName: (f) => `Get${cap(f)}`,
        setterName: (f) => `Set${cap(f)}`,
        getter: (p) => [`public ${p.type || 'object'} Get${cap(p.field)}() {`, `    return this.${p.backing};`, '}'],
        setter: (p) => [
          `public void Set${cap(p.field)}(${p.type || 'object'} value) {`,
          `    this.${p.backing} = value;`,
          '}',
        ],
        transparent: false,
        privatize: MAKE_PRIVATE,
      }
    case 'kotlin':
      return {
        getterName: (f) => `get${cap(f)}`,
        setterName: (f) => `set${cap(f)}`,
        getter: (p) => [`fun get${cap(p.field)}()${p.type ? `: ${p.type}` : ''} = ${p.backing}`],
        setter: (p) => [`fun set${cap(p.field)}(value${p.type ? `: ${p.type}` : ''}) { ${p.backing} = value }`],
        transparent: false,
        privatize: MAKE_PRIVATE,
      }
    case 'swift':
      return {
        getterName: (f) => `get${cap(f)}`,
        setterName: (f) => `set${cap(f)}`,
        getter: (p) => [`func get${cap(p.field)}()${p.type ? ` -> ${p.type}` : ''} {`, `    return self.${p.backing}`, '}'],
        setter: (p) => [`func set${cap(p.field)}(_ value: ${p.type || 'Any'}) {`, `    self.${p.backing} = value`, '}'],
        transparent: false,
        privatize: MAKE_PRIVATE,
      }
    case 'php':
      return {
        getterName: (f) => `get${cap(f)}`,
        setterName: (f) => `set${cap(f)}`,
        getter: (p) => [`public function get${cap(p.field)}() {`, `    return $this->${p.backing};`, '}'],
        setter: (p) => [`public function set${cap(p.field)}($value) {`, `    $this->${p.backing} = $value;`, '}'],
        transparent: false,
        privatize: MAKE_PRIVATE,
      }
    case 'dart':
      return {
        getterName: (f) => `get${cap(f)}`,
        setterName: (f) => `set${cap(f)}`,
        getter: (p) => [`${p.type || 'dynamic'} get ${p.field} => ${p.backing};`],
        setter: (p) => [`set ${p.field}(${p.type || 'dynamic'} value) => ${p.backing} = value;`],
        transparent: true,
        backingField: (f) => `_${f}`,
        privatize: KEEP,
      }
    case 'python':
      return {
        getterName: (f) => f,
        setterName: (f) => f,
        getter: (p) => ['@property', `def ${p.field}(self)${p.type ? ` -> ${p.type}` : ''}:`, `    return self.${p.backing}`],
        setter: (p) => [`@${p.field}.setter`, `def ${p.field}(self, value):`, `    self.${p.backing} = value`],
        transparent: true,
        backingField: (f) => `_${f}`,
        privatize: KEEP,
      }
    case 'go':
      return {
        getterName: (f) => cap(f),
        setterName: (f) => `Set${cap(f)}`,
        getter: (p) => [`func (r *Receiver) ${cap(p.field)}() ${p.type || 'interface{}'} {`, `\treturn r.${p.backing}`, '}'],
        setter: (p) => [
          `func (r *Receiver) Set${cap(p.field)}(value ${p.type || 'interface{}'}) {`,
          `\tr.${p.backing} = value`,
          '}',
        ],
        transparent: false,
        privatize: KEEP,
      }
    default:
      return null
  }
}

export interface EncapsulatePreparation {
  ok: true
  field: string
  className: string
  type: string
  getterName: string
  setterName: string
  /** True when accessors are properties and call sites stay unchanged. */
  transparent: boolean
  /** Reads and writes found in the declaring file. */
  reads: number
  writes: number
  /** Other files that mention the name at all. */
  otherFiles: string[]
}

export async function prepareEncapsulateField(
  site: RefactorSite,
  workspace: RefactorWorkspace,
): Promise<EncapsulatePreparation | { ok: false; reason: string }> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const shape = accessorShape(ctx.profile.id)
  if (!shape) return fail(`Encapsulate Field is not supported for ${site.language}.`)
  const found = fieldAt(ctx)
  if (!found) return fail('Put the caret on a field declaration inside a class.')

  const typed = /:\s*([^=;]+)/.exec(ctx.lines[found.line])
  const type = typed ? typed[1].trim() : ''
  const accesses = fieldAccesses(ctx, found.name, found.line)
  const references = await workspace.references(found.name, site.file).catch(() => [])

  return {
    ok: true,
    field: found.name,
    className: found.cls.name,
    type,
    getterName: shape.getterName(found.name),
    setterName: shape.setterName(found.name),
    transparent: shape.transparent,
    reads: accesses.filter((a) => !a.write).length,
    writes: accesses.filter((a) => a.write).length,
    otherFiles: [...new Set(references.filter((r) => r.file !== site.file && r.kind === 'code').map((r) => r.file))],
  }
}

interface FieldAccess {
  start: number
  end: number
  write: boolean
  /** For a write, the offsets of the value being assigned. */
  valueStart: number
  valueEnd: number
  /** `this.` / `self.` / `obj.` — kept so the rewrite preserves the receiver. */
  receiverStart: number
  compound: boolean
}

/** `<receiver>.field` occurrences, split into reads and writes. */
function fieldAccesses(ctx: RefactorContext, field: string, declarationLine: number): FieldAccess[] {
  const out: FieldAccess[] = []
  for (const start of occurrences(ctx.masked, field)) {
    const line = ctx.lineOf(start)
    if (line === declarationLine) continue
    // Must be a member access; a bare local of the same name is not the field.
    let before = start - 1
    while (before >= 0 && /\s/.test(ctx.masked.mask[before])) before--
    if (ctx.masked.mask[before] !== '.') continue
    let receiverStart = before
    while (receiverStart > 0 && /[\w$\].)]/.test(ctx.masked.mask[receiverStart - 1])) receiverStart--

    const end = start + field.length
    let cursor = end
    while (cursor < ctx.text.length && /[ \t]/.test(ctx.masked.mask[cursor])) cursor++
    const compound = /^[+\-*/%|&^]=(?!=)/.test(ctx.masked.mask.slice(cursor, cursor + 2))
    const assign = ctx.masked.mask[cursor] === '=' && ctx.masked.mask[cursor + 1] !== '='

    if (!assign && !compound) {
      out.push({ start, end, write: false, valueStart: -1, valueEnd: -1, receiverStart, compound: false })
      continue
    }
    const span = statementLines(ctx.lines, ctx.masked, ctx.starts, ctx.profile, line)
    const statementEnd = ctx.starts[span.to] + ctx.lines[span.to].length
    const valueStart = ctx.masked.mask.indexOf('=', cursor) + 1
    let valueEnd = statementEnd
    const semicolon = ctx.masked.mask.lastIndexOf(';', statementEnd)
    if (semicolon > valueStart) valueEnd = semicolon
    out.push({
      start,
      end,
      write: true,
      valueStart,
      valueEnd,
      receiverStart,
      compound,
    })
  }
  return out
}

/** Rewrites the field reads inside a slice, last-first so offsets stay valid. */
function rewriteReadsIn(
  ctx: RefactorContext,
  from: number,
  to: number,
  reads: FieldAccess[],
  getterName: string,
): string {
  let value = ctx.text.slice(from, to)
  for (const read of [...reads].sort((a, b) => b.start - a.start)) {
    value = value.slice(0, read.start - from) + `${getterName}()` + value.slice(read.end - from)
  }
  return value.trim()
}

export interface EncapsulateOptions {
  getterName: string
  setterName: string
  generateSetter: boolean
  /** Rewrite reads and writes in the declaring file. */
  updateAccesses: boolean
}

export function encapsulateField(
  site: RefactorSite,
  options: EncapsulateOptions,
): RefactorResult {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const shape = accessorShape(ctx.profile.id)
  if (!shape) return fail(`Encapsulate Field is not supported for ${site.language}.`)
  const found = fieldAt(ctx)
  if (!found) return fail('Put the caret on a field declaration inside a class.')

  const typed = /:\s*([^=;]+)/.exec(ctx.lines[found.line])
  const type = typed ? typed[1].trim() : ''
  const backing = shape.backingField ? shape.backingField(found.name) : found.name
  const parts: AccessorParts = { field: found.name, backing, type, receiver: ctx.profile.receiver }

  const edits: TextEdit[] = []
  const warnings: string[] = []

  // The declaration itself: private, and renamed when the language needs a
  // separate backing field for the property to sit on top of.
  const declaration = ctx.lines[found.line]
  let rewritten = shape.privatize(declaration)
  if (backing !== found.name) {
    rewritten = rewritten.replace(new RegExp(`\\b${found.name}\\b`), backing)
  }
  if (rewritten !== declaration) {
    edits.push({
      range: { start: { line: found.line, character: 0 }, end: { line: found.line, character: declaration.length } },
      newText: rewritten,
    })
  }

  // Accessors go straight after the declaration, at the field's own indentation.
  const indent = indentOf(declaration)
  const accessorLines = [
    ...shape.getter(parts),
    ...(options.generateSetter ? ['', ...shape.setter(parts)] : []),
  ]
  edits.push({
    range: { start: { line: found.line + 1, character: 0 }, end: { line: found.line + 1, character: 0 } },
    newText: `${accessorLines.map((line) => (line ? indent + line : '')).join('\n')}\n`,
  })

  if (options.updateAccesses && !shape.transparent) {
    const accesses = fieldAccesses(ctx, found.name, found.line)
    const writes = accesses.filter((a) => a.write)
    // `this.n = this.n + 1` contains a read *inside* the write's own range.
    // Emitting both would produce overlapping edits, so the inner reads are
    // folded into the setter argument instead.
    const swallowed = new Set(
      accesses.filter((read) =>
        !read.write &&
        writes.some((write) => read.start >= write.receiverStart && read.end <= write.valueEnd),
      ),
    )

    for (const access of accesses) {
      if (swallowed.has(access)) continue
      if (access.compound) {
        warnings.push(
          `The compound assignment on line ${ctx.lineOf(access.start) + 1} was left alone — rewrite it by hand.`,
        )
        continue
      }
      if (!access.write) {
        edits.push({
          range: { start: ctx.positionOf(access.start), end: ctx.positionOf(access.end) },
          newText: `${options.getterName}()`,
        })
        continue
      }
      if (!options.generateSetter) {
        warnings.push('A write was found but no setter was generated — it was left alone.')
        continue
      }
      const value = rewriteReadsIn(
        ctx,
        access.valueStart,
        access.valueEnd,
        accesses.filter(
          (read) => swallowed.has(read) && read.start >= access.valueStart && read.end <= access.valueEnd,
        ),
        options.getterName,
      )
      const receiver = ctx.text.slice(access.receiverStart, access.start)
      edits.push({
        range: { start: ctx.positionOf(access.receiverStart), end: ctx.positionOf(access.valueEnd) },
        newText: `${receiver}${options.setterName}(${value})`,
      })
    }
  } else if (shape.transparent) {
    warnings.push('Call sites keep using the plain name — the accessors are properties.')
  }

  if (ctx.profile.id === 'go') {
    warnings.push('The generated receiver is a placeholder — rename `r *Receiver` to the real struct.')
  }

  return succeed(
    `Encapsulate Field “${found.name}” in ${found.cls.name}`,
    fileEdit(site.file, edits),
    warnings,
  )
}

/* ================================================================== */
/* Invert Boolean                                                      */
/* ================================================================== */

export interface InvertBooleanPreparation {
  ok: true
  name: string
  kind: 'function' | 'variable'
  suggestedName: string
  /** Return statements or the initializer that will be negated. */
  valueCount: number
  usageCount: number
}

/** `isValid` → `isNotValid`, `enabled` → `disabled`, else `notX`. */
export function invertedName(name: string): string {
  const pairs: [RegExp, string][] = [
    [/^is([A-Z])/, 'isNot$1'],
    [/^has([A-Z])/, 'hasNo$1'],
    [/^can([A-Z])/, 'cannot$1'],
    [/^should([A-Z])/, 'shouldNot$1'],
    [/^enabled$/, 'disabled'],
    [/^disabled$/, 'enabled'],
    [/^visible$/, 'hidden'],
    [/^valid$/, 'invalid'],
    [/^invalid$/, 'valid'],
    [/^is_(\w+)/, 'is_not_$1'],
  ]
  for (const [pattern, replacement] of pairs) {
    if (pattern.test(name)) return name.replace(pattern, replacement)
  }
  return `not${name[0].toUpperCase()}${name.slice(1)}`
}

function returnStatementsIn(ctx: RefactorContext, fn: Declaration): { line: number; expr: string }[] {
  const found: { line: number; expr: string }[] = []
  for (let line = fn.line + 1; line <= fn.endLine; line++) {
    const match = /^(\s*)return\b\s*(.*?);?\s*$/.exec(ctx.lines[line])
    if (!match || !match[2]) continue
    found.push({ line, expr: match[2] })
  }
  return found
}

export async function prepareInvertBoolean(
  site: RefactorSite,
  workspace: RefactorWorkspace,
): Promise<InvertBooleanPreparation | { ok: false; reason: string }> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const word = wordAtOffset(ctx.text, ctx.start)
  if (!word) return fail('Put the caret on a boolean function or variable.')

  const fn = allFunctions(ctx.lines, ctx.masked, ctx.starts, ctx.profile).find((f) => f.name === word.name)
  const references = await workspace.references(word.name, site.file).catch(() => [])
  const usageCount = references.filter((r) => r.kind === 'code').length

  if (fn) {
    const returns = returnStatementsIn(ctx, fn)
    if (returns.length === 0) {
      return fail(`\`${word.name}\` has no \`return\` statement the engine can invert.`)
    }
    return {
      ok: true,
      name: word.name,
      kind: 'function',
      suggestedName: invertedName(word.name),
      valueCount: returns.length,
      usageCount,
    }
  }

  const assignment = new RegExp(`^\\s*(?:let|const|var|val|final)?\\s*\\$?${word.name}\\b[^=\\n]*=(?!=)\\s*(.+)$`)
  const line = ctx.lines.findIndex((l) => assignment.test(l))
  if (line === -1) return fail(`No declaration of \`${word.name}\` was found in this file.`)
  return {
    ok: true,
    name: word.name,
    kind: 'variable',
    suggestedName: invertedName(word.name),
    valueCount: 1,
    usageCount: occurrences(ctx.masked, word.name).length - 1,
  }
}

export interface InvertBooleanOptions {
  newName: string
}

export async function invertBoolean(
  site: RefactorSite,
  options: InvertBooleanOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const word = wordAtOffset(ctx.text, ctx.start)
  if (!word) return fail('Put the caret on a boolean function or variable.')
  const newName = options.newName.trim()
  if (!/^[A-Za-z_$][\w$]*$/.test(newName)) return fail(`“${options.newName}” is not a valid name.`)

  const languageId = ctx.profile.id.replace(/react$/, '')
  const fn = allFunctions(ctx.lines, ctx.masked, ctx.starts, ctx.profile).find((f) => f.name === word.name)
  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []

  if (fn) {
    const edits: TextEdit[] = []
    for (const statement of returnStatementsIn(ctx, fn)) {
      const line = ctx.lines[statement.line]
      const start = line.indexOf(statement.expr)
      edits.push({
        range: {
          start: { line: statement.line, character: start },
          end: { line: statement.line, character: start + statement.expr.length },
        },
        newText: negate(statement.expr, languageId),
      })
    }
    // The declaration's own name.
    const nameStart = ctx.lines[fn.line].indexOf(word.name)
    edits.push({
      range: {
        start: { line: fn.line, character: nameStart },
        end: { line: fn.line, character: nameStart + word.name.length },
      },
      newText: newName,
    })
    changes[site.file] = edits

    const references = await workspace.references(word.name, site.file).catch(() => [])
    const files = [...new Set([site.file, ...references.filter((r) => r.kind === 'code').map((r) => r.file)])]
    let rewritten = 0
    for (const file of files) {
      const text = file === site.file ? ctx.text : await workspace.readFile(file)
      if (text === null) continue
      const fileCtx = analyze({
        file,
        language: file === site.file ? site.language : languageForPath(file),
        text,
        range: ZERO_RANGE,
      })
      if (isFailure(fileCtx)) continue
      const { calls } = findCallSites(
        file,
        text,
        fileCtx.masked,
        word.name,
        (line) => file === site.file && line === fn.line,
        (offset) => fileCtx.lineOf(offset),
      )
      for (const call of calls) {
        const start = call.openParen - word.name.length
        const args = text.slice(call.openParen, call.closeParen + 1)
        // A call already under `!` becomes a plain call: two negations cancel.
        let from = start
        let prefix = `${notOperator(languageId).prefix}`
        let probe = start - 1
        while (probe >= 0 && /\s/.test(text[probe])) probe--
        if (languageId === 'python' ? /not\s*$/.test(text.slice(Math.max(0, probe - 3), probe + 1)) : text[probe] === '!') {
          from = languageId === 'python' ? probe - 2 : probe
          prefix = ''
        }
        changes[file] = [
          ...(changes[file] ?? []),
          {
            range: { start: fileCtx.positionOf(from), end: fileCtx.positionOf(call.closeParen + 1) },
            newText: `${prefix}${newName}${args}`,
          },
        ]
        rewritten++
      }
    }
    if (rewritten === 0) warnings.push('No call site was rewritten — check the preview.')
    return succeed(
      `Invert Boolean “${word.name}” → “${newName}”`,
      { changes },
      warnings,
    )
  }

  // Variable: invert the initializer, rename, negate every later usage.
  const assignment = new RegExp(`^(\\s*(?:let|const|var|val|final)?\\s*\\$?)(${word.name})\\b([^=\\n]*)=(?!=)\\s*(.+?)\\s*;?\\s*$`)
  let declarationLine = -1
  let match: RegExpExecArray | null = null
  for (let line = 0; line < ctx.lines.length; line++) {
    const candidate = assignment.exec(ctx.lines[line])
    if (candidate) {
      declarationLine = line
      match = candidate
      break
    }
  }
  if (declarationLine === -1 || !match) return fail(`No declaration of \`${word.name}\` was found in this file.`)

  const edits: TextEdit[] = []
  const original = ctx.lines[declarationLine]
  const inverted = `${match[1]}${newName}${match[3]}= ${negate(match[4], languageId)}${original.trimEnd().endsWith(';') ? ';' : ''}`
  edits.push({
    range: { start: { line: declarationLine, character: 0 }, end: { line: declarationLine, character: original.length } },
    newText: inverted,
  })

  const declarationStart = ctx.starts[declarationLine]
  const declarationEnd = declarationStart + original.length
  for (const offset of occurrences(ctx.masked, word.name)) {
    if (offset >= declarationStart && offset <= declarationEnd) continue
    let probe = offset - 1
    while (probe >= 0 && /\s/.test(ctx.text[probe])) probe--
    const alreadyNegated =
      languageId === 'python'
        ? /\bnot\s*$/.test(ctx.text.slice(Math.max(0, probe - 4), probe + 1))
        : ctx.text[probe] === '!'
    const from = alreadyNegated ? (languageId === 'python' ? probe - 2 : probe) : offset
    edits.push({
      range: { start: ctx.positionOf(from), end: ctx.positionOf(offset + word.name.length) },
      newText: alreadyNegated ? newName : `${notOperator(languageId).prefix}${newName}`,
    })
  }

  return succeed(`Invert Boolean “${word.name}” → “${newName}”`, fileEdit(site.file, edits), warnings)
}

/* ================================================================== */
/* Inline Parameter                                                    */
/* ================================================================== */

export interface InlineParameterPreparation {
  ok: true
  functionName: string
  parameterName: string
  index: number
  /** The value every call site passes, when they agree. */
  value: string
  callSiteCount: number
  disagreeing: string[]
}

function parameterAt(ctx: RefactorContext): { fn: Declaration; index: number; name: string } | null {
  const caret = ctx.start
  const functions = allFunctions(ctx.lines, ctx.masked, ctx.starts, ctx.profile)
  const word = wordAtOffset(ctx.text, caret)
  if (!word) return null
  for (const fn of functions) {
    if (fn.paramsStart < 0 || fn.paramsEnd < 0) continue
    const params = parseParams(ctx.text, ctx.masked, fn.paramsStart, fn.paramsEnd)
    const positional = params.filter((p) => !p.receiver)
    const index = positional.findIndex((p) => p.name === word.name)
    if (index === -1) continue
    // Either the caret is in the header, or it is on a usage inside the body.
    if (caret >= fn.paramsStart && caret <= fn.paramsEnd) return { fn, index, name: word.name }
    if (caret >= ctx.starts[fn.line] && caret <= ctx.starts[fn.endLine]) return { fn, index, name: word.name }
  }
  return null
}

export async function prepareInlineParameter(
  site: RefactorSite,
  workspace: RefactorWorkspace,
): Promise<InlineParameterPreparation | { ok: false; reason: string }> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const found = parameterAt(ctx)
  if (!found) return fail('Put the caret on a parameter of the enclosing function.')

  const references = await workspace.references(found.fn.name, site.file).catch(() => [])
  const files = [...new Set([site.file, ...references.filter((r) => r.kind === 'code').map((r) => r.file)])]
  const values = new Set<string>()
  let callSiteCount = 0

  for (const file of files) {
    const text = file === site.file ? ctx.text : await workspace.readFile(file)
    if (text === null) continue
    const fileCtx = analyze({
      file,
      language: file === site.file ? site.language : languageForPath(file),
      text,
      range: ZERO_RANGE,
    })
    if (isFailure(fileCtx)) continue
    const { calls } = findCallSites(
      file,
      text,
      fileCtx.masked,
      found.fn.name,
      (line) => file === site.file && line === found.fn.line,
      (offset) => fileCtx.lineOf(offset),
    )
    for (const call of calls) {
      callSiteCount++
      const argument = call.args[found.index]
      values.add(argument ? argument.text.trim() : '<missing>')
    }
  }

  if (callSiteCount === 0) return fail(`No call to \`${found.fn.name}\` was found.`)
  if (values.size > 1) {
    return fail(
      `Call sites pass ${values.size} different values for \`${found.name}\` (${[...values].slice(0, 3).join(', ')}) — Inline Parameter needs them to agree.`,
    )
  }

  return {
    ok: true,
    functionName: found.fn.name,
    parameterName: found.name,
    index: found.index,
    value: [...values][0] ?? '',
    callSiteCount,
    disagreeing: [],
  }
}

export async function inlineParameter(
  site: RefactorSite,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const preparation = await prepareInlineParameter(site, workspace)
  if (!preparation.ok) return preparation

  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const found = parameterAt(ctx)
  if (!found) return fail('Put the caret on a parameter of the enclosing function.')

  const params = parseParams(ctx.text, ctx.masked, found.fn.paramsStart, found.fn.paramsEnd)
  const positional = params.filter((p) => !p.receiver)
  const kept = positional.filter((_p, index) => index !== found.index)
  const receivers = params.filter((p) => p.receiver)
  const rendered = [...receivers.map((p) => p.raw), ...kept.map((p) => p.raw)].join(', ')

  const changes: Record<string, TextEdit[]> = {}
  const edits: TextEdit[] = [
    {
      range: { start: ctx.positionOf(found.fn.paramsStart), end: ctx.positionOf(found.fn.paramsEnd) },
      newText: rendered,
    },
  ]

  // A local at the top of the body takes the parameter's place.
  const bodyIndent = found.fn.indent + ctx.indent
  const local = ctx.profile.local(found.name, preparation.value)
  const insertAt = found.fn.line + 1
  edits.push({
    range: { start: { line: insertAt, character: 0 }, end: { line: insertAt, character: 0 } },
    newText: `${bodyIndent}${local}\n`,
  })
  changes[site.file] = edits

  const references = await workspace.references(found.fn.name, site.file).catch(() => [])
  const files = [...new Set([site.file, ...references.filter((r) => r.kind === 'code').map((r) => r.file)])]
  for (const file of files) {
    const text = file === site.file ? ctx.text : await workspace.readFile(file)
    if (text === null) continue
    const fileCtx = analyze({
      file,
      language: file === site.file ? site.language : languageForPath(file),
      text,
      range: ZERO_RANGE,
    })
    if (isFailure(fileCtx)) continue
    const { calls } = findCallSites(
      file,
      text,
      fileCtx.masked,
      found.fn.name,
      (line) => file === site.file && line === found.fn.line,
      (offset) => fileCtx.lineOf(offset),
    )
    for (const call of calls) {
      const argument = call.args[found.index]
      if (!argument) continue
      const others = call.args.filter((_a, index) => index !== found.index)
      changes[file] = [
        ...(changes[file] ?? []),
        {
          range: {
            start: fileCtx.positionOf(call.openParen + 1),
            end: fileCtx.positionOf(call.closeParen),
          },
          newText: others.map((a) => a.text.trim()).join(', '),
        },
      ]
    }
  }

  return succeed(
    `Inline Parameter “${preparation.parameterName}” = ${preparation.value}`,
    { changes },
    [`${preparation.callSiteCount} call site(s) had the argument removed.`],
  )
}

/* ================================================================== */
/* Inline Field                                                        */
/* ================================================================== */

export interface InlineFieldPreparation {
  ok: true
  name: string
  className: string
  value: string
  usageCount: number
}

export function prepareInlineField(
  site: RefactorSite,
): InlineFieldPreparation | { ok: false; reason: string } {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const found = fieldAt(ctx)
  if (!found) return fail('Put the caret on a field declaration inside a class.')

  const initializer = /=\s*(.+?)\s*;?\s*$/.exec(ctx.lines[found.line])
  if (!initializer) return fail(`\`${found.name}\` has no initializer to inline.`)

  const accesses = fieldAccesses(ctx, found.name, found.line)
  const writes = accesses.filter((a) => a.write)
  if (writes.length) {
    return fail(
      `\`${found.name}\` is assigned in ${writes.length} other place(s) — inlining it would change behaviour.`,
    )
  }
  if (accesses.length === 0) return fail(`\`${found.name}\` is never read in this file.`)

  return {
    ok: true,
    name: found.name,
    className: found.cls.name,
    value: initializer[1],
    usageCount: accesses.length,
  }
}

export interface InlineFieldOptions {
  keepDeclaration?: boolean
}

export function inlineField(site: RefactorSite, options: InlineFieldOptions = {}): RefactorResult {
  const preparation = prepareInlineField(site)
  if (!preparation.ok) return preparation
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const found = fieldAt(ctx)
  if (!found) return fail('Put the caret on a field declaration inside a class.')

  const replacement = parenthesizeIfNeeded(preparation.value)
  const edits: TextEdit[] = fieldAccesses(ctx, found.name, found.line).map((access) => ({
    range: { start: ctx.positionOf(access.receiverStart), end: ctx.positionOf(access.end) },
    newText: replacement,
  }))

  if (!options.keepDeclaration) {
    edits.push({ range: lineRange(ctx.text, found.line, found.line), newText: '' })
  }

  const warnings: string[] = []
  if (/\(/.test(preparation.value)) {
    warnings.push(
      `The value contains a call, so it now runs ${edits.length} time(s) instead of once — check for side effects.`,
    )
  }

  return succeed(
    `Inline Field “${preparation.name}” (${preparation.usageCount} usage${preparation.usageCount === 1 ? '' : 's'})`,
    fileEdit(site.file, edits),
    warnings,
  )
}

/** Exposed for the class-shaped refactorings that also need the class list. */
export function classesIn(ctx: RefactorContext) {
  return allClasses(ctx.lines, ctx.masked, ctx.starts, ctx.profile)
}
