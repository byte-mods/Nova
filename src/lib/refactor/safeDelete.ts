/**
 * Safe Delete.
 *
 * The point of the refactoring is the check, not the deletion: it finds every
 * reference first and refuses to remove a symbol that is still used unless the
 * user says so explicitly. Comment and string matches are reported separately,
 * because they never block a delete but are usually worth fixing.
 */

import { analyze, isFailure } from './context'
import { declarationAtLine, lineRange, wordAtOffset } from './syntax'
import {
  fail,
  succeed,
  type IndexReference,
  type RefactorResult,
  type RefactorSite,
  type RefactorWorkspace,
  type TextEdit,
} from './types'

export interface SafeDeletePreparation {
  ok: true
  name: string
  /** 0-based line range that would be removed. */
  from: number
  to: number
  /** References that make the delete unsafe. */
  blocking: IndexReference[]
  /** Mentions in comments and strings — reported, never blocking. */
  soft: IndexReference[]
  /** True when the symbol is the only declaration in its file. */
  wholeFile: boolean
}

export async function prepareSafeDelete(
  site: RefactorSite,
  workspace: RefactorWorkspace,
): Promise<SafeDeletePreparation | { ok: false; reason: string }> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const word = wordAtOffset(ctx.text, ctx.start)
  if (!word) return fail('Put the caret on the symbol you want to delete.')

  const caretLine = ctx.lineOf(ctx.start)
  const declaration =
    declarationAtLine(ctx.lines, ctx.masked, ctx.starts, ctx.profile, caretLine) ??
    (ctx.fn?.name === word.name ? ctx.fn : null) ??
    (ctx.cls?.name === word.name ? ctx.cls : null)

  const span = declaration
    ? { from: declaration.line, to: declaration.endLine }
    : { from: caretLine, to: caretLine }

  const name = declaration?.name ?? word.name
  const references = await workspace.references(name, site.file)
  const inDeclaration = (reference: IndexReference) =>
    reference.file === site.file && reference.line - 1 >= span.from && reference.line - 1 <= span.to

  const blocking = references.filter(
    (r) => (r.kind === 'code' || r.kind === 'import') && !inDeclaration(r),
  )
  const soft = references.filter((r) => (r.kind === 'comment' || r.kind === 'string') && !inDeclaration(r))

  const meaningfulLines = ctx.lines.filter(
    (line, index) =>
      line.trim() &&
      !(index >= span.from && index <= span.to) &&
      !ctx.profile.lineComments.some((c) => line.trimStart().startsWith(c)) &&
      !/^\s*(import|from|package|using|#include|use|require)\b/.test(line),
  )

  return {
    ok: true,
    name,
    from: span.from,
    to: span.to,
    blocking,
    soft,
    wholeFile: meaningfulLines.length === 0,
  }
}

export interface SafeDeleteOptions {
  /** Proceed even though references remain. */
  force?: boolean
  /** Remove the file entirely rather than just the declaration. */
  deleteFile?: boolean
}

export async function safeDelete(
  site: RefactorSite,
  options: SafeDeleteOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const preparation = await prepareSafeDelete(site, workspace)
  if (!preparation.ok) return preparation

  if (preparation.blocking.length > 0 && !options.force) {
    const where = preparation.blocking
      .slice(0, 5)
      .map((r) => `${r.file.split('/').pop()}:${r.line}`)
      .join(', ')
    return fail(
      `\`${preparation.name}\` is still used in ${preparation.blocking.length} place(s): ${where}${preparation.blocking.length > 5 ? '…' : ''}`,
    )
  }

  const warnings: string[] = []
  if (preparation.blocking.length > 0) {
    warnings.push(
      `Deleting anyway — ${preparation.blocking.length} reference(s) will break. They are listed in the Usages panel.`,
    )
  }
  if (preparation.soft.length > 0) {
    warnings.push(`${preparation.soft.length} mention(s) in comments or strings were left untouched.`)
  }

  if (options.deleteFile) {
    return succeed(
      `Safe Delete “${preparation.name}” and its file`,
      { documentChanges: [{ kind: 'delete', uri: site.file }] },
      warnings,
    )
  }

  const edits: TextEdit[] = [
    { range: lineRange(site.text, preparation.from, preparation.to), newText: '' },
  ]
  if (preparation.wholeFile) {
    warnings.push('This was the last declaration in the file — the file itself is left in place.')
  }
  return succeed(`Safe Delete “${preparation.name}”`, { changes: { [site.file]: edits } }, warnings)
}
