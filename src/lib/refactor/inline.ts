/**
 * Inline Variable and Inline Method.
 *
 * Both refuse loudly rather than guessing. A variable that is assigned twice,
 * or a function whose body is more than one expression, cannot be inlined by
 * substitution without changing behaviour — so those cases return a reason the
 * dialog shows, instead of writing something plausible-looking.
 */

import { languageForPath } from '../../../shared/languages'
import { analyze, isFailure, parenthesizeIfNeeded, type RefactorContext } from './context'
import { parseParams, findCallSites } from './params'
import {
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

/* ================================================================== */
/* Inline Variable                                                     */
/* ================================================================== */

export interface InlineVariablePreparation {
  ok: true
  name: string
  value: string
  usageCount: number
  declarationLine: number
}

/** `let x = 1 + 2` on the caret's scope, plus how many places would change. */
function findLocalDeclaration(
  ctx: RefactorContext,
  name: string,
): { line: number; from: number; to: number; value: string } | null {
  const scopeFrom = ctx.fn ? ctx.fn.line : 0
  const scopeTo = ctx.fn ? ctx.fn.endLine : ctx.lines.length - 1

  const pattern = new RegExp(
    `^\\s*(?:(?:pub|export|private|public|protected|static|final|readonly)\\s+)*` +
      `(?:let|const|var|val|final|my)?\\s*\\$?${name}\\b\\s*(?::[^=]+?)?\\s*(?::=|=)(?!=)\\s*(.*)$`,
  )

  for (let line = scopeFrom; line <= scopeTo; line++) {
    const match = pattern.exec(ctx.lines[line])
    if (!match) continue
    const span = statementLines(ctx.lines, ctx.masked, ctx.starts, ctx.profile, line)
    const tail = ctx.lines.slice(line, span.to + 1).join('\n')
    const equals = tail.indexOf(match[1])
    const value = (equals === -1 ? match[1] : tail.slice(equals)).trim().replace(/;$/, '').trim()
    if (!value) continue
    return { line, from: span.from, to: span.to, value }
  }
  return null
}

export function prepareInlineVariable(
  site: RefactorSite,
): InlineVariablePreparation | { ok: false; reason: string } {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const word = wordAtOffset(ctx.text, ctx.start)
  if (!word) return fail('Put the caret on a variable first.')

  const declaration = findLocalDeclaration(ctx, word.name)
  if (!declaration) return fail(`No declaration of \`${word.name}\` was found in this scope.`)

  const scope = scopeOffsets(ctx)
  const hits = occurrences(ctx.masked, word.name, scope.from, scope.to)
  const declarationEnd = ctx.starts[declaration.to] + ctx.lines[declaration.to].length
  const usages = hits.filter((offset) => offset > declarationEnd)

  const reassigned = countAssignments(ctx, word.name, scope) > 1
  if (reassigned) {
    return fail(`\`${word.name}\` is assigned more than once — inlining it would change behaviour.`)
  }

  return {
    ok: true,
    name: word.name,
    value: declaration.value,
    usageCount: usages.length,
    declarationLine: declaration.line,
  }
}

export interface InlineVariableOptions {
  /** Keep the declaration and only replace the usages. */
  keepDeclaration?: boolean
}

export function inlineVariable(site: RefactorSite, options: InlineVariableOptions = {}): RefactorResult {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const word = wordAtOffset(ctx.text, ctx.start)
  if (!word) return fail('Put the caret on a variable first.')

  const declaration = findLocalDeclaration(ctx, word.name)
  if (!declaration) return fail(`No declaration of \`${word.name}\` was found in this scope.`)

  const scope = scopeOffsets(ctx)
  if (countAssignments(ctx, word.name, scope) > 1) {
    return fail(`\`${word.name}\` is assigned more than once — inlining it would change behaviour.`)
  }

  const declarationStart = ctx.starts[declaration.from]
  const declarationEnd = ctx.starts[declaration.to] + ctx.lines[declaration.to].length
  const replacement = parenthesizeIfNeeded(declaration.value)

  const edits: TextEdit[] = occurrences(ctx.masked, word.name, scope.from, scope.to)
    .filter((offset) => offset < declarationStart || offset > declarationEnd)
    .map((offset) => ({
      range: { start: ctx.positionOf(offset), end: ctx.positionOf(offset + word.name.length) },
      newText: replacement,
    }))

  if (edits.length === 0) {
    return fail(`\`${word.name}\` has no usages to inline.`)
  }

  if (!options.keepDeclaration) {
    edits.push({ range: lineRange(ctx.text, declaration.from, declaration.to), newText: '' })
  }

  const warnings: string[] = []
  if (/\(/.test(declaration.value)) {
    warnings.push(
      `The value contains a call, so it will now run ${edits.length} time(s) instead of once — check for side effects.`,
    )
  }

  return succeed(
    `Inline Variable “${word.name}” (${edits.length} usage${edits.length === 1 ? '' : 's'})`,
    fileEdit(site.file, edits),
    warnings,
  )
}

function scopeOffsets(ctx: RefactorContext): { from: number; to: number } {
  if (!ctx.fn) return { from: 0, to: ctx.text.length }
  return {
    from: ctx.starts[ctx.fn.line],
    to: ctx.fn.endLine + 1 < ctx.starts.length ? ctx.starts[ctx.fn.endLine + 1] : ctx.text.length,
  }
}

function countAssignments(ctx: RefactorContext, name: string, scope: { from: number; to: number }): number {
  const region = ctx.masked.mask.slice(scope.from, scope.to)
  const original = ctx.text.slice(scope.from, scope.to)
  const pattern = new RegExp(`\\b\\$?${name}\\b\\s*(?::[^=\\n]*)?(?:=|:=|\\+=|-=|\\*=|/=)(?!=)`, 'g')
  let count = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(original))) {
    // Only count matches that survive masking, i.e. real code.
    if (region[match.index] !== ' ' || original[match.index] === ' ') count++
  }
  return count
}

/* ================================================================== */
/* Inline Method                                                       */
/* ================================================================== */

export interface InlineMethodPreparation {
  ok: true
  name: string
  parameters: string[]
  body: string
  callSiteCount: number
}

interface SimpleBody {
  declaration: Declaration
  expression: string
  params: string[]
}

/** A function whose body is a single expression, or null when it is not. */
function readSimpleBody(ctx: RefactorContext, name: string): SimpleBody | { reason: string } | null {
  const declaration = allFunctions(ctx.lines, ctx.masked, ctx.starts, ctx.profile).find(
    (fn) => fn.name === name,
  )
  if (!declaration) return null

  const bodyLines = ctx.lines
    .slice(declaration.line + 1, declaration.endLine + 1)
    .map((line) => line.trim())
    .filter((line) => line && line !== '}' && line !== 'end')

  if (bodyLines.length === 0) return { reason: `\`${name}\` has an empty body.` }
  if (bodyLines.length > 1) {
    return {
      reason: `\`${name}\` has ${bodyLines.length} statements — Inline Method only handles a single-expression body.`,
    }
  }

  const only = bodyLines[0]
  const returned = /^return\s+(.*?);?$/.exec(only)
  const expression = (returned ? returned[1] : only).replace(/;$/, '').trim()
  if (!expression) return { reason: `\`${name}\` does not return a value.` }

  const params = parseParams(ctx.text, ctx.masked, declaration.paramsStart, declaration.paramsEnd)
    .map((p) => p.name)
    .filter((p) => p && p !== 'self' && p !== '&self' && p !== 'this')

  return { declaration, expression, params }
}

export async function prepareInlineMethod(
  site: RefactorSite,
  workspace: RefactorWorkspace,
): Promise<InlineMethodPreparation | { ok: false; reason: string }> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const word = wordAtOffset(ctx.text, ctx.start)
  if (!word) return fail('Put the caret on a function name first.')

  const body = readSimpleBody(ctx, word.name)
  if (body === null) return fail(`\`${word.name}\` is not declared in this file.`)
  if ('reason' in body) return fail(body.reason)

  const references = await workspace.references(word.name, site.file)
  return {
    ok: true,
    name: word.name,
    parameters: body.params,
    body: body.expression,
    callSiteCount: references.filter((r) => r.kind === 'code').length,
  }
}

export interface InlineMethodOptions {
  /** Delete the declaration once every call site has been replaced. */
  removeDeclaration: boolean
}

export async function inlineMethod(
  site: RefactorSite,
  options: InlineMethodOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const word = wordAtOffset(ctx.text, ctx.start)
  if (!word) return fail('Put the caret on a function name first.')

  const body = readSimpleBody(ctx, word.name)
  if (body === null) return fail(`\`${word.name}\` is not declared in this file.`)
  if ('reason' in body) return fail(body.reason)

  const references = await workspace.references(word.name, site.file)
  const files = [...new Set(references.filter((r) => r.kind === 'code').map((r) => r.file))]
  if (!files.includes(site.file)) files.push(site.file)

  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []
  let inlined = 0
  let skipped = 0

  for (const file of files) {
    const text = file === site.file ? ctx.text : await workspace.readFile(file)
    if (text === null) continue
    const language = file === site.file ? site.language : languageForPath(file)
    const fileCtx = analyze({ file, language, text, range: ZERO_RANGE })
    if (isFailure(fileCtx)) continue

    const declarationLines = new Set<number>(
      file === site.file ? [body.declaration.line] : [],
    )
    const { calls, unparsed } = findCallSites(
      file,
      text,
      fileCtx.masked,
      word.name,
      (line) => declarationLines.has(line),
      (offset) => fileCtx.lineOf(offset),
    )
    skipped += unparsed.length

    for (const call of calls) {
      if (call.args.length !== body.params.length) {
        skipped++
        continue
      }
      const substituted = substitute(body.expression, body.params, call.args.map((a) => a.text.trim()), fileCtx)
      const start = call.openParen - word.name.length
      changes[file] = [
        ...(changes[file] ?? []),
        {
          range: { start: fileCtx.positionOf(start), end: fileCtx.positionOf(call.closeParen + 1) },
          newText: parenthesizeIfNeeded(substituted),
        },
      ]
      inlined++
    }
  }

  if (inlined === 0) return fail(`No call to \`${word.name}\` could be rewritten.`)

  if (options.removeDeclaration) {
    if (skipped > 0) {
      warnings.push(
        `${skipped} call site(s) were left as they are, so the declaration was kept — remove it by hand once they are handled.`,
      )
    } else {
      changes[site.file] = [
        ...(changes[site.file] ?? []),
        { range: lineRange(ctx.text, body.declaration.line, body.declaration.endLine), newText: '' },
      ]
    }
  } else if (skipped > 0) {
    warnings.push(`${skipped} call site(s) could not be rewritten and were left alone.`)
  }

  return succeed(
    `Inline Method “${word.name}” (${inlined} call site${inlined === 1 ? '' : 's'})`,
    { changes },
    warnings,
  )
}

/** Replaces parameter names in the body expression with the call's arguments. */
function substitute(expression: string, params: string[], args: string[], ctx: RefactorContext): string {
  let result = expression
  params.forEach((param, index) => {
    const argument = parenthesizeIfNeeded(args[index] ?? param)
    result = result.replace(new RegExp(`\\b${escapeRegExp(param)}\\b`, 'g'), () => argument)
  })
  // A receiver-qualified body (`this.x`) only makes sense inside its own class.
  if (ctx.profile.receiver && result.includes(ctx.profile.receiver)) {
    return result
  }
  return result
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
