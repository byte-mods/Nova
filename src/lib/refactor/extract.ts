/**
 * Extract Variable / Constant / Field / Parameter / Method.
 *
 * All five share one shape: take a selection, introduce a named thing for it,
 * and replace the selection (optionally every identical occurrence in scope)
 * with that name. What differs is *where* the declaration lands and what
 * receiver the replacement needs.
 */

import { languageForPath } from '../../../shared/languages'
import { analyze, isFailure, validateExpression, type RefactorContext } from './context'
import { constantStyle, inferType, namingStyle, suggestName, uniqueName } from './naming'
import { parseParams, findCallSites } from './params'
import {
  dedent,
  indentOf,
  lineRange,
  occurrences,
  statementLines,
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

/** Placeholder range for contexts built purely to scan another file. */
const ZERO_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

/* ================================================================== */
/* preparation — what the dialog needs to show                         */
/* ================================================================== */

export interface ExtractPreparation {
  ok: true
  expression: string
  suggestedName: string
  /** Occurrences of the same expression in the enclosing scope, including this one. */
  occurrenceCount: number
  inferredType: string
  /** True when the language will not compile without a type here. */
  typeRequired: boolean
  hasEnclosingFunction: boolean
  hasEnclosingClass: boolean
  className: string
  functionName: string
}

export function prepareExtract(
  site: RefactorSite,
  target: 'variable' | 'constant' | 'field' | 'parameter',
): ExtractPreparation | { ok: false; reason: string } {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const invalid = validateExpression(ctx)
  if (invalid) return invalid

  const expression = ctx.selection.trim()
  const style = target === 'constant' ? constantStyle(ctx.profile) : namingStyle(ctx.profile)
  const base = suggestName(expression, style === 'screaming' ? 'screaming' : style)
  const taken = (name: string) => occurrences(ctx.masked, name).length > 0
  const scope = scopeFor(ctx, target)

  const typeRequired =
    (target === 'variable' && ctx.profile.typedLocals) ||
    (target === 'field' && ctx.profile.typedFields) ||
    (target === 'parameter' && ctx.profile.typedParams) ||
    (target === 'constant' && (ctx.profile.typedFields || ctx.profile.typedLocals))

  return {
    ok: true,
    expression,
    suggestedName: uniqueName(base, taken),
    occurrenceCount: occurrences(ctx.masked, expression, scope.from, scope.to).length,
    inferredType: inferType(expression, ctx.profile),
    typeRequired,
    hasEnclosingFunction: Boolean(ctx.fn),
    hasEnclosingClass: Boolean(ctx.cls),
    className: ctx.cls?.name ?? '',
    functionName: ctx.fn?.name ?? '',
  }
}

/** Offset range the "replace all occurrences" search runs over. */
function scopeFor(ctx: RefactorContext, target: string): { from: number; to: number } {
  if (target === 'variable' || target === 'parameter') {
    if (ctx.fn) return { from: ctx.starts[ctx.fn.line], to: endOffsetOfLine(ctx, ctx.fn.endLine) }
  }
  if (target === 'field' && ctx.cls) {
    return { from: ctx.starts[ctx.cls.line], to: endOffsetOfLine(ctx, ctx.cls.endLine) }
  }
  return { from: 0, to: ctx.text.length }
}

function endOffsetOfLine(ctx: RefactorContext, line: number): number {
  return line + 1 < ctx.starts.length ? ctx.starts[line + 1] : ctx.text.length
}

/* ================================================================== */
/* Extract Variable                                                    */
/* ================================================================== */

export interface ExtractVariableOptions {
  name: string
  replaceAll: boolean
  type?: string
}

export function extractVariable(site: RefactorSite, options: ExtractVariableOptions): RefactorResult {
  return extractLocal(site, options, 'variable')
}

export function extractConstant(site: RefactorSite, options: ExtractVariableOptions): RefactorResult {
  return extractLocal(site, options, 'constant')
}

function extractLocal(
  site: RefactorSite,
  options: ExtractVariableOptions,
  kind: 'variable' | 'constant',
): RefactorResult {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const invalid = validateExpression(ctx)
  if (invalid) return invalid
  const nameError = validateName(options.name)
  if (nameError) return nameError

  const expression = ctx.selection.trim()
  const scope = scopeFor(ctx, kind)
  const hits = options.replaceAll
    ? occurrences(ctx.masked, expression, scope.from, scope.to)
    : [ctx.start]
  if (hits.length === 0) return fail('The selected expression was not found in the enclosing scope.')

  const warnings: string[] = []

  if (kind === 'variable') {
    // The declaration must precede the earliest occurrence it feeds.
    const first = Math.min(...hits)
    const firstLine = ctx.lineOf(first)
    const statement = statementLines(ctx.lines, ctx.masked, ctx.starts, ctx.profile, firstLine)
    const indent = indentOf(ctx.lines[statement.from])
    const declaration = ctx.profile.local(options.name, expression, options.type || undefined)
    const statementText = ctx.lines
      .slice(statement.from, statement.to + 1)
      .join('\n')
      .trim()
      .replace(/;$/, '')
      .trim()

    // When the expression *is* the whole statement, the declaration takes its
    // place — inserting above and leaving `name` behind would strand a
    // no-op expression statement.
    const replacesStatement = statementText === expression
    const edits: TextEdit[] = hits
      .filter((offset) => !replacesStatement || offset !== first)
      .map((offset) => ({
        range: { start: ctx.positionOf(offset), end: ctx.positionOf(offset + expression.length) },
        newText: options.name,
      }))

    edits.push(
      replacesStatement
        ? {
            range: lineRange(ctx.text, statement.from, statement.to),
            newText: `${indent}${declaration}\n`,
          }
        : {
            range: { start: { line: statement.from, character: 0 }, end: { line: statement.from, character: 0 } },
            newText: `${indent}${declaration}\n`,
          },
    )

    if (hits.length > 1) {
      warnings.push(
        `Replacing ${hits.length} occurrences — check that the expression has no side effects, since it will now run once.`,
      )
    }
    return succeed(`Extract Variable “${options.name}”`, fileEdit(site.file, edits), warnings)
  }

  const edits: TextEdit[] = hits.map((offset) => ({
    range: { start: ctx.positionOf(offset), end: ctx.positionOf(offset + expression.length) },
    newText: options.name,
  }))

  const placement = constantPlacement(ctx)
  const declaration = ctx.profile.constant(options.name, expression, options.type || undefined)
  edits.push({
    range: { start: { line: placement.line, character: 0 }, end: { line: placement.line, character: 0 } },
    newText: `${placement.indent}${declaration}\n${placement.blankAfter ? '\n' : ''}`,
  })
  if (placement.note) warnings.push(placement.note)

  return succeed(`Extract Constant “${options.name}”`, fileEdit(site.file, edits), warnings)
}

/** Where a constant goes: top of the enclosing class, or after the file header. */
function constantPlacement(ctx: RefactorContext): {
  line: number
  indent: string
  blankAfter: boolean
  note: string
} {
  const classScoped = ['java', 'csharp', 'kotlin', 'scala', 'dart', 'swift', 'php']
  if (classScoped.includes(ctx.profile.id) && ctx.cls) {
    return {
      line: ctx.cls.line + 1,
      indent: ctx.cls.indent + ctx.indent,
      blankAfter: true,
      note: '',
    }
  }
  return { line: headerEndLine(ctx), indent: '', blankAfter: true, note: '' }
}

/**
 * First line after the file's header block — package/import/using/#include and
 * the leading comment. New top-level declarations go here.
 */
function headerEndLine(ctx: RefactorContext): number {
  const headerPattern =
    /^\s*(import\b|from\b|package\b|using\b|#include\b|#import\b|use\b|require\b|require_relative\b|namespace\b|declare\b|@|<\?php|'use strict'|"use strict")/
  let last = 0
  for (let i = 0; i < ctx.lines.length; i++) {
    const line = ctx.lines[i]
    if (!line.trim()) continue
    const isComment = ctx.profile.lineComments.some((c) => line.trimStart().startsWith(c))
    if (headerPattern.test(line) || isComment) {
      last = i + 1
      continue
    }
    break
  }
  return last
}

/* ================================================================== */
/* Extract Field                                                       */
/* ================================================================== */

export interface ExtractFieldOptions {
  name: string
  replaceAll: boolean
  type?: string
  isStatic?: boolean
}

export function extractField(site: RefactorSite, options: ExtractFieldOptions): RefactorResult {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const invalid = validateExpression(ctx)
  if (invalid) return invalid
  const nameError = validateName(options.name)
  if (nameError) return nameError
  if (!ctx.cls) return fail('Extract Field needs a surrounding class — the caret is at file scope.')

  const expression = ctx.selection.trim()
  const scope = scopeFor(ctx, 'field')
  const hits = options.replaceAll ? occurrences(ctx.masked, expression, scope.from, scope.to) : [ctx.start]
  const reference = `${ctx.profile.receiver}${options.name}`
  const warnings: string[] = []

  const edits: TextEdit[] = hits.map((offset) => ({
    range: { start: ctx.positionOf(offset), end: ctx.positionOf(offset + expression.length) },
    newText: reference,
  }))

  if (ctx.profile.id === 'python') {
    const init = findMethodIn(ctx, ctx.cls, '__init__')
    if (init) {
      // `self.x = …` belongs at the end of __init__, after the existing setup.
      const indent = indentOf(ctx.lines[init.line]) + ctx.indent
      edits.push({
        range: { start: { line: init.endLine + 1, character: 0 }, end: { line: init.endLine + 1, character: 0 } },
        newText: `${indent}self.${options.name} = ${expression}\n`,
      })
      if (expressionUsesLocals(ctx, expression, init)) {
        warnings.push('The expression may reference names that only exist outside `__init__` — check the diff.')
      }
    } else {
      edits.push({
        range: { start: { line: ctx.cls.line + 1, character: 0 }, end: { line: ctx.cls.line + 1, character: 0 } },
        newText: `${ctx.cls.indent + ctx.indent}${options.name} = ${expression}\n`,
      })
      warnings.push('No `__init__` found, so the field was added as a class attribute.')
    }
  } else {
    const declaration = ctx.profile.field(
      options.name,
      expression,
      options.type || undefined,
      Boolean(options.isStatic),
    )
    edits.push({
      range: { start: { line: ctx.cls.line + 1, character: 0 }, end: { line: ctx.cls.line + 1, character: 0 } },
      newText: `${ctx.cls.indent + ctx.indent}${declaration}\n`,
    })
  }

  if (hits.length > 1) {
    warnings.push(`Replacing ${hits.length} occurrences with \`${reference}\`.`)
  }
  return succeed(`Extract Field “${options.name}”`, fileEdit(site.file, edits), warnings)
}

function findMethodIn(ctx: RefactorContext, cls: Declaration, name: string): Declaration | null {
  for (let i = cls.line + 1; i <= cls.endLine; i++) {
    const match = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/.exec(ctx.lines[i])
    if (match?.[1] === name) {
      let end = i
      const base = indentOf(ctx.lines[i]).length
      for (let j = i + 1; j <= cls.endLine; j++) {
        if (!ctx.lines[j].trim()) continue
        if (indentOf(ctx.lines[j]).length <= base) break
        end = j
      }
      return { kind: 'function', name, line: i, endLine: end, indent: indentOf(ctx.lines[i]), paramsStart: -1, paramsEnd: -1, headerStart: 0, headerEnd: 0 }
    }
  }
  return null
}

function expressionUsesLocals(ctx: RefactorContext, expression: string, init: Declaration): boolean {
  const names = expression.match(/[A-Za-z_$][\w$]*/g) ?? []
  const initText = ctx.lines.slice(init.line, init.endLine + 1).join('\n')
  return names.some(
    (name) => !ctx.profile.keywords.has(name) && name !== 'self' && !initText.includes(name),
  )
}

/* ================================================================== */
/* Extract Parameter                                                   */
/* ================================================================== */

export interface ExtractParameterOptions {
  name: string
  type?: string
  /** Give the new parameter a default so existing calls keep compiling. */
  useDefault: boolean
  /** Pass the original expression explicitly at every call site. */
  updateCallSites: boolean
}

export async function extractParameter(
  site: RefactorSite,
  options: ExtractParameterOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const invalid = validateExpression(ctx)
  if (invalid) return invalid
  const nameError = validateName(options.name)
  if (nameError) return nameError
  if (!ctx.fn) return fail('Extract Parameter needs a surrounding function.')
  if (ctx.fn.paramsStart < 0 || ctx.fn.paramsEnd < 0) {
    return fail(`Could not read the parameter list of \`${ctx.fn.name}\`.`)
  }

  const expression = ctx.selection.trim()
  const warnings: string[] = []
  const bodyFrom = ctx.starts[ctx.fn.line]
  const bodyTo = endOffsetOfLine(ctx, ctx.fn.endLine)
  const hits = occurrences(ctx.masked, expression, bodyFrom, bodyTo)

  const edits: TextEdit[] = hits.map((offset) => ({
    range: { start: ctx.positionOf(offset), end: ctx.positionOf(offset + expression.length) },
    newText: options.name,
  }))

  const existing = parseParams(ctx.text, ctx.masked, ctx.fn.paramsStart, ctx.fn.paramsEnd)
  const useDefault = options.useDefault && ctx.profile.supportsDefaultParams
  const rendered = ctx.profile.param(
    options.name,
    options.type || undefined,
    useDefault ? expression : undefined,
  )
  const separator = existing.length ? ', ' : ''
  edits.push({
    range: { start: ctx.positionOf(ctx.fn.paramsEnd), end: ctx.positionOf(ctx.fn.paramsEnd) },
    newText: `${separator}${rendered}`,
  })

  const edit = fileEdit(site.file, edits)

  if (options.updateCallSites && !useDefault) {
    const callResult = await rewriteCallSites(
      workspace,
      ctx,
      ctx.fn.name,
      site.file,
      (args) => [...args, expression],
      ctx.fn.line,
    )
    for (const [file, fileEdits] of Object.entries(callResult.changes)) {
      edit.changes![file] = [...(edit.changes![file] ?? []), ...fileEdits]
    }
    warnings.push(...callResult.warnings)
    if (callResult.count === 0) warnings.push('No call sites were found to update.')
  } else if (!useDefault) {
    warnings.push(
      `Call sites were not updated — \`${ctx.fn.name}\` now takes one more argument, so existing calls need it added.`,
    )
  } else {
    warnings.push('Existing call sites keep working through the new default value.')
  }

  return succeed(`Extract Parameter “${options.name}”`, edit, warnings)
}

/* ================================================================== */
/* Extract Method                                                      */
/* ================================================================== */

export interface ExtractMethodPreparation {
  ok: true
  /** The exact lines that will move. */
  body: string[]
  suggestedName: string
  parameters: string[]
  returns: string | null
  isMethod: boolean
  className: string
  typeRequired: boolean
  warnings: string[]
}

export function prepareExtractMethod(
  site: RefactorSite,
): ExtractMethodPreparation | { ok: false; reason: string } {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  if (!ctx.selection.trim()) return fail('Select the statements to extract first.')
  if (!ctx.fn) return fail('Extract Method needs a surrounding function.')

  const span = selectedStatementLines(ctx)
  if (span.from <= ctx.fn.line) {
    return fail('The selection includes the function header — select only statements from its body.')
  }
  if (span.to > ctx.fn.endLine) return fail('The selection runs past the end of the function.')

  const body = ctx.lines.slice(span.from, span.to + 1)
  const analysis = dataFlow(ctx, span)
  if (analysis.assignedAndUsedAfter.length > 1) {
    return fail(
      `The selection assigns ${analysis.assignedAndUsedAfter.length} variables that are still used afterwards (${analysis.assignedAndUsedAfter.join(', ')}). Extract Method can only return one value.`,
    )
  }

  const taken = (name: string) => occurrences(ctx.masked, name).length > 0
  const style = namingStyle(ctx.profile)
  const seed = suggestName(body[0]?.trim() ?? 'extracted', style)
  const suggested =
    style === 'snake' ? `extracted_${seed}` : `extracted${seed[0].toUpperCase()}${seed.slice(1)}`

  return {
    ok: true,
    body,
    suggestedName: uniqueName(suggested, taken),
    parameters: analysis.parameters,
    returns: analysis.assignedAndUsedAfter[0] ?? null,
    isMethod: Boolean(ctx.cls),
    className: ctx.cls?.name ?? '',
    typeRequired: ctx.profile.typedParams,
    warnings: analysis.warnings,
  }
}

export interface ExtractMethodOptions {
  name: string
  /** One entry per parameter, in order; `type` only used where required. */
  parameters: { name: string; type?: string }[]
  returns: string | null
  returnType?: string
  visibility?: 'public' | 'private' | 'protected'
  isStatic?: boolean
}

export function extractMethod(site: RefactorSite, options: ExtractMethodOptions): RefactorResult {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const nameError = validateName(options.name)
  if (nameError) return nameError
  if (!ctx.fn) return fail('Extract Method needs a surrounding function.')

  const span = selectedStatementLines(ctx)
  const selected = ctx.lines.slice(span.from, span.to + 1)
  const { lines: bodyLines } = dedent(selected)
  const callIndent = indentOf(ctx.lines[span.from])
  const isMethod = Boolean(ctx.cls)

  // The new function sits beside the one it came out of, at its indentation.
  const declIndent = ctx.fn.indent
  const bodyIndent = declIndent + ctx.indent

  const params = options.parameters.map((p) => ctx.profile.param(p.name, p.type || undefined))
  if (isMethod && ctx.profile.implicitSelfParam) params.unshift(ctx.profile.implicitSelfParam)

  const header = ctx.profile.functionHeader({
    name: options.name,
    params,
    returnType: options.returnType,
    isMethod,
    isStatic: Boolean(options.isStatic),
    visibility: options.visibility ?? 'private',
  })
  const footer = ctx.profile.functionFooter()

  const newLines = [
    `${declIndent}${header}`,
    ...bodyLines.map((line) => (line ? bodyIndent + line : '')),
    ...(options.returns ? [`${bodyIndent}${ctx.profile.returnStatement(options.returns)}`] : []),
    ...(footer ? [`${declIndent}${footer}`] : []),
  ]

  const receiver = isMethod && ctx.profile.receiver ? ctx.profile.receiver : ''
  const args = options.parameters.map((p) => p.name)
  const call = `${receiver}${options.name}(${args.join(', ')})`
  const callStatement = options.returns
    ? `${callIndent}${ctx.profile.local(options.returns, call).replace(/^(const|let|var|val|final)\s+/, reuseBinding(ctx, options.returns, span))}`
    : `${callIndent}${call}${ctx.profile.terminator}`

  const edits: TextEdit[] = [
    { range: lineRange(ctx.text, span.from, span.to), newText: `${callStatement}\n` },
    {
      range: { start: { line: ctx.fn.endLine + 1, character: 0 }, end: { line: ctx.fn.endLine + 1, character: 0 } },
      newText: `\n${newLines.join('\n')}\n`,
    },
  ]

  const warnings: string[] = []
  if (options.parameters.length === 0) {
    warnings.push('The extracted code takes no parameters — confirm it does not depend on local state.')
  }
  warnings.push('Parameters are inferred from names, not types — check the new signature before applying.')

  return succeed(
    `Extract ${isMethod ? 'Method' : 'Function'} “${options.name}”`,
    fileEdit(site.file, edits),
    warnings,
  )
}

/**
 * When the returned name was already declared before the selection, the call
 * must assign to it rather than redeclare it.
 */
function reuseBinding(ctx: RefactorContext, name: string, span: { from: number }): string {
  const before = ctx.lines.slice(0, span.from).join('\n')
  const declared = new RegExp(`\\b(?:let|const|var|val|final)\\s+${name}\\b`).test(before)
  return declared ? '' : '$1 '
}

/** Rounds the selection out to whole lines. */
function selectedStatementLines(ctx: RefactorContext): { from: number; to: number } {
  const from = ctx.lineOf(ctx.start)
  const to = ctx.lineOf(Math.max(ctx.start, ctx.end - 1))
  const head = statementLines(ctx.lines, ctx.masked, ctx.starts, ctx.profile, from)
  const tail = statementLines(ctx.lines, ctx.masked, ctx.starts, ctx.profile, to)
  return { from: Math.min(from, head.from), to: Math.max(to, tail.to) }
}

const BINDING_PATTERNS = [
  /\b(?:let|const|var|val|final)\s+([A-Za-z_$][\w$]*)/g,
  /\b([A-Za-z_$][\w$]*)\s*:=/g,
  /^[ \t]*([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=(?!=)/gm,
  /\bfor\s*\(?\s*(?:let|const|var)?\s*([A-Za-z_$][\w$]*)/g,
  /\bfor\s+([A-Za-z_$][\w$]*)\s+in\b/g,
  /\bas\s+([A-Za-z_$][\w$]*)/g,
  /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g,
]

function bindingsIn(text: string): Set<string> {
  const names = new Set<string>()
  for (const pattern of BINDING_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) names.add(match[1])
  }
  return names
}

/**
 * Which names the selection needs from outside (parameters) and which it
 * produces for the code after it (the return value).
 *
 * This reads bindings, not scopes — it is a heuristic, which is why the result
 * is surfaced in an editable dialog and then in the diff.
 */
function dataFlow(
  ctx: RefactorContext,
  span: { from: number; to: number },
): { parameters: string[]; assignedAndUsedAfter: string[]; warnings: string[] } {
  const fn = ctx.fn!
  const beforeText = ctx.lines.slice(fn.line, span.from).join('\n')
  const selectionText = ctx.lines.slice(span.from, span.to + 1).join('\n')
  const afterText = ctx.lines.slice(span.to + 1, fn.endLine + 1).join('\n')

  const declaredBefore = bindingsIn(beforeText)
  for (const param of parseParams(ctx.text, ctx.masked, fn.paramsStart, fn.paramsEnd)) {
    if (param.name) declaredBefore.add(param.name)
  }
  const declaredInside = bindingsIn(selectionText)

  const used = new Set<string>()
  const selectionStart = ctx.starts[span.from]
  const selectionEnd = span.to + 1 < ctx.starts.length ? ctx.starts[span.to + 1] : ctx.text.length
  for (const hit of identifiersInRange(ctx, selectionStart, selectionEnd)) {
    if (hit.member) continue
    if (ctx.profile.keywords.has(hit.name)) continue
    used.add(hit.name)
  }

  const parameters = [...used].filter((name) => declaredBefore.has(name) && !isSelfName(ctx, name))
  const assignedAndUsedAfter = [...declaredInside].filter((name) =>
    new RegExp(`\\b${name}\\b`).test(afterText),
  )

  const warnings: string[] = []
  if (/\breturn\b/.test(selectionText)) {
    warnings.push('The selection contains a `return` — it will return from the extracted function instead.')
  }
  if (/\b(break|continue)\b/.test(selectionText)) {
    warnings.push('The selection contains `break`/`continue`, which cannot cross a function boundary.')
  }
  return { parameters: parameters.sort(), assignedAndUsedAfter, warnings }
}

function isSelfName(ctx: RefactorContext, name: string) {
  return name === 'self' || name === 'this' || name === 'cls'
}

function identifiersInRange(ctx: RefactorContext, from: number, to: number) {
  const pattern = /[A-Za-z_$][A-Za-z0-9_$]*/g
  const hits: { name: string; member: boolean }[] = []
  const region = ctx.masked.mask.slice(from, to)
  let match: RegExpExecArray | null
  while ((match = pattern.exec(region))) {
    const absolute = from + match.index
    const before = ctx.masked.mask.slice(Math.max(0, absolute - 2), absolute)
    hits.push({ name: match[0], member: /\.$/.test(before) || /->$/.test(before) || /::$/.test(before) })
  }
  return hits
}

/* ================================================================== */
/* shared helpers                                                      */
/* ================================================================== */

export function validateName(name: string) {
  if (!name || !name.trim()) return fail('Enter a name.')
  if (!/^[A-Za-z_$][\w$]*$/.test(name.trim())) {
    return fail(`“${name}” is not a valid identifier.`)
  }
  return null
}

/**
 * Rewrites every call to `name` across the project with a new argument list.
 *
 * `declarationLine` is the header being edited: it must be excluded explicitly,
 * because a declaration is textually `name(` too and would otherwise have the
 * new argument spliced into its parameter list.
 */
export async function rewriteCallSites(
  workspace: RefactorWorkspace,
  ctx: RefactorContext,
  name: string,
  originFile: string,
  transform: (args: string[]) => string[],
  declarationLine = -1,
): Promise<{ changes: Record<string, TextEdit[]>; warnings: string[]; count: number }> {
  const references = await workspace.references(name, originFile)
  const files = [...new Set(references.filter((r) => r.kind === 'code').map((r) => r.file))]
  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []
  let count = 0

  for (const file of files) {
    const text = file === originFile ? ctx.text : await workspace.readFile(file)
    if (text === null) continue
    // Calls can live in a different language than the declaration (a Python
    // module called from a test file, say), so re-derive it per file.
    const language = file === originFile ? ctx.site.language : languageForPath(file)
    const fileCtx = analyze({ file, language, text, range: ZERO_RANGE })
    if (isFailure(fileCtx)) continue

    const declarationLines = new Set(
      references.filter((r) => r.file === file && r.kind === 'declaration').map((r) => r.line - 1),
    )
    if (file === originFile && declarationLine >= 0) declarationLines.add(declarationLine)
    const { calls, unparsed } = findCallSites(
      file,
      text,
      fileCtx.masked,
      name,
      (line) => declarationLines.has(line),
      (offset) => fileCtx.lineOf(offset),
    )
    if (unparsed.length) {
      warnings.push(`${file.split('/').pop()}: ${unparsed.length} call(s) could not be parsed and were left alone.`)
    }

    for (const call of calls) {
      const next = transform(call.args.map((a) => a.text.trim()))
      const rendered = next.join(', ')
      changes[file] = [
        ...(changes[file] ?? []),
        {
          range: {
            start: fileCtx.positionOf(call.openParen + 1),
            end: fileCtx.positionOf(call.closeParen),
          },
          newText: rendered,
        },
      ]
      count++
    }
  }

  return { changes, warnings, count }
}
