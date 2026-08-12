/**
 * Pull Members Up and Push Members Down.
 *
 * The hierarchy is read from the class header — `extends B`, `: B`, `(B)`,
 * `< B` — and resolved through the symbol index, so it works without a
 * language server. Subclasses are found the cheap way: every reference to the
 * class name that lands on a class header is a candidate child.
 */

import { languageForPath } from '../../../shared/languages'
import { analyze, isFailure, type RefactorContext } from './context'
import {
  allClasses,
  declarationAtLine,
  dedent,
  indentOf,
  lineRange,
  type Declaration,
} from './syntax'
import {
  fail,
  succeed,
  type RefactorResult,
  type RefactorSite,
  type RefactorWorkspace,
  type TextEdit,
} from './types'

const ZERO_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

export interface MemberTarget {
  /** Class name. */
  name: string
  file: string
  /** 0-based header line. */
  line: number
}

export interface MembersPreparation {
  ok: true
  memberName: string
  memberLines: string[]
  sourceClass: string
  /** Where the member could go. Empty when the hierarchy has no other end. */
  targets: MemberTarget[]
  direction: 'up' | 'down'
}

/** Base classes named in a class header. */
export function baseClassesOf(header: string, language: string): string[] {
  const patterns: RegExp[] = [
    /\bextends\s+([A-Za-z_$][\w$.]*(?:\s*,\s*[A-Za-z_$][\w$.]*)*)/,
    /\bimplements\s+([A-Za-z_$][\w$.]*(?:\s*,\s*[A-Za-z_$][\w$.]*)*)/,
  ]
  if (language === 'python') patterns.push(/\bclass\s+\w+\s*\(([^)]*)\)/)
  if (language === 'ruby') patterns.push(/\bclass\s+[\w:]+\s*<\s*([\w:]+)/)
  if (['kotlin', 'scala', 'swift', 'csharp', 'typescript', 'typescriptreact', 'dart'].includes(language)) {
    patterns.push(/\bclass\s+\w+(?:<[^>]*>)?\s*(?::|\bextends\b)\s*([A-Za-z_$][\w$.<>, ]*)/)
  }

  const names = new Set<string>()
  for (const pattern of patterns) {
    const match = pattern.exec(header)
    if (!match) continue
    for (const part of match[1].split(',')) {
      const name = part.trim().replace(/<.*$/, '').replace(/\(.*$/, '').split('.').pop()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'object') names.add(name)
    }
  }
  return [...names]
}

/** The member (method or field) the caret sits on, plus its owning class. */
function memberAt(ctx: RefactorContext): { member: { from: number; to: number; name: string }; cls: Declaration } | null {
  if (!ctx.cls) return null
  const caretLine = ctx.lineOf(ctx.start)
  if (caretLine <= ctx.cls.line || caretLine > ctx.cls.endLine) return null

  const declaration = declarationAtLine(ctx.lines, ctx.masked, ctx.starts, ctx.profile, caretLine)
  if (declaration && declaration.kind === 'function') {
    return { member: { from: declaration.line, to: declaration.endLine, name: declaration.name }, cls: ctx.cls }
  }

  // Otherwise treat the caret's line as a field declaration.
  const line = ctx.lines[caretLine]
  if (!line.trim()) return null
  const field = /([A-Za-z_$][\w$]*)\s*[:=;]/.exec(line) ?? /([A-Za-z_$][\w$]*)\s*$/.exec(line.trim())
  if (!field) return null
  return { member: { from: caretLine, to: caretLine, name: field[1] }, cls: ctx.cls }
}

export async function prepareMembers(
  site: RefactorSite,
  direction: 'up' | 'down',
  workspace: RefactorWorkspace,
): Promise<MembersPreparation | { ok: false; reason: string }> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const found = memberAt(ctx)
  if (!found) return fail('Put the caret on a method or field inside a class.')

  const targets =
    direction === 'up'
      ? await findSuperclasses(ctx, found.cls, workspace)
      : await findSubclasses(ctx, found.cls, workspace)

  if (targets.length === 0) {
    return fail(
      direction === 'up'
        ? `\`${found.cls.name}\` has no base class the index can resolve.`
        : `No subclass of \`${found.cls.name}\` was found in the project.`,
    )
  }

  return {
    ok: true,
    memberName: found.member.name,
    memberLines: ctx.lines.slice(found.member.from, found.member.to + 1),
    sourceClass: found.cls.name,
    targets,
    direction,
  }
}

async function findSuperclasses(
  ctx: RefactorContext,
  cls: Declaration,
  workspace: RefactorWorkspace,
): Promise<MemberTarget[]> {
  const bases = baseClassesOf(ctx.lines[cls.line], ctx.profile.id)
  const targets: MemberTarget[] = []
  for (const base of bases) {
    for (const symbol of await workspace.definitions(base, ctx.site.file)) {
      if (!['class', 'interface', 'struct', 'trait'].includes(symbol.kind)) continue
      targets.push({ name: symbol.name, file: symbol.file, line: symbol.line - 1 })
    }
  }
  return dedupeTargets(targets)
}

async function findSubclasses(
  ctx: RefactorContext,
  cls: Declaration,
  workspace: RefactorWorkspace,
): Promise<MemberTarget[]> {
  const references = await workspace.references(cls.name, ctx.site.file)
  const targets: MemberTarget[] = []
  const byFile = new Map<string, typeof references>()
  for (const reference of references) {
    if (reference.kind !== 'code') continue
    byFile.set(reference.file, [...(byFile.get(reference.file) ?? []), reference])
  }

  for (const [file, fileReferences] of byFile) {
    const text = file === ctx.site.file ? ctx.text : await workspace.readFile(file)
    if (text === null) continue
    const language = file === ctx.site.file ? ctx.site.language : languageForPath(file)
    const fileCtx = analyze({ file, language, text, range: ZERO_RANGE })
    if (isFailure(fileCtx)) continue

    const classes = allClasses(fileCtx.lines, fileCtx.masked, fileCtx.starts, fileCtx.profile)
    for (const reference of fileReferences) {
      const line = reference.line - 1
      const candidate = classes.find((c) => c.line === line)
      if (!candidate || candidate.name === cls.name) continue
      if (!baseClassesOf(fileCtx.lines[line], fileCtx.profile.id).includes(cls.name)) continue
      targets.push({ name: candidate.name, file, line })
    }
  }
  return dedupeTargets(targets)
}

function dedupeTargets(targets: MemberTarget[]): MemberTarget[] {
  const seen = new Set<string>()
  return targets.filter((target) => {
    const key = `${target.file}:${target.line}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface MembersOptions {
  direction: 'up' | 'down'
  /** One or more of the targets from `prepareMembers`. */
  targets: MemberTarget[]
  /** Leave the member in place as well (Push Down to several subclasses). */
  keepOriginal?: boolean
}

export async function moveMembers(
  site: RefactorSite,
  options: MembersOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const found = memberAt(ctx)
  if (!found) return fail('Put the caret on a method or field inside a class.')
  if (options.targets.length === 0) return fail('Choose at least one target class.')

  const selected = ctx.lines.slice(found.member.from, found.member.to + 1)
  const { lines: bodyLines } = dedent(selected)
  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []

  for (const target of options.targets) {
    const text = target.file === site.file ? ctx.text : await workspace.readFile(target.file)
    if (text === null) {
      warnings.push(`Could not read ${target.file.split('/').pop()} — skipped.`)
      continue
    }
    const language = target.file === site.file ? site.language : languageForPath(target.file)
    const targetCtx = analyze({ file: target.file, language, text, range: ZERO_RANGE })
    if (isFailure(targetCtx)) {
      warnings.push(`No syntax profile for ${target.file.split('/').pop()} — skipped.`)
      continue
    }

    const targetClass = allClasses(targetCtx.lines, targetCtx.masked, targetCtx.starts, targetCtx.profile).find(
      (c) => c.line === target.line,
    )
    if (!targetClass) {
      warnings.push(`\`${target.name}\` was not found at ${target.file.split('/').pop()}:${target.line + 1} — skipped.`)
      continue
    }

    const memberIndent = targetClass.indent + targetCtx.indent
    const rendered = bodyLines.map((line) => (line ? memberIndent + line : '')).join('\n')
    // Members go at the end of the body, just before the closing line.
    const insertLine = targetCtx.profile.indentScoped ? targetClass.endLine + 1 : targetClass.endLine
    changes[target.file] = [
      ...(changes[target.file] ?? []),
      {
        range: { start: { line: insertLine, character: 0 }, end: { line: insertLine, character: 0 } },
        newText: `\n${rendered}\n`,
      },
    ]
  }

  if (Object.keys(changes).length === 0) return fail('No target class could be updated.')

  if (!options.keepOriginal) {
    changes[site.file] = [
      ...(changes[site.file] ?? []),
      { range: lineRange(ctx.text, found.member.from, found.member.to), newText: '' },
    ]
  }

  const memberText = selected.join('\n')
  if (ctx.profile.receiver && memberText.includes(ctx.profile.receiver)) {
    warnings.push(
      `The member uses \`${ctx.profile.receiver}\` — check that everything it touches also exists on the target class.`,
    )
  }
  const crossFile = options.targets.some((t) => t.file !== site.file)
  if (crossFile) warnings.push('The member moved to another file — imports were not adjusted.')

  const verb = options.direction === 'up' ? 'Pull Up' : 'Push Down'
  return succeed(
    `${verb} “${found.member.name}” → ${options.targets.map((t) => t.name).join(', ')}`,
    { changes },
    warnings,
  )
}
