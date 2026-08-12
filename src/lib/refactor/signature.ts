/**
 * Change Signature and Introduce Parameter Object.
 *
 * Both rewrite a declaration and then every call site the symbol index knows
 * about. Arguments are matched to parameters positionally, which is what makes
 * reordering possible: each new parameter carries the index it had before, so
 * a call's arguments can be permuted to match without re-parsing types.
 */

import { languageForPath } from '../../../shared/languages'
import { analyze, isFailure, type RefactorContext } from './context'
import { validateName } from './extract'
import { findCallSites, parseParams, type ParsedParam } from './params'
import { declarationAtLine, enclosingFunction, occurrences, type Declaration } from './syntax'
import {
  fail,
  succeed,
  type RefactorResult,
  type RefactorSite,
  type RefactorWorkspace,
  type TextEdit,
} from './types'

const ZERO_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

export interface SignaturePreparation {
  ok: true
  functionName: string
  params: ParsedParam[]
  returnType: string
  typeRequired: boolean
  supportsDefaults: boolean
  declarationLine: number
}

/** Reads the signature under the caret, whether on the header or in the body. */
function targetDeclaration(ctx: RefactorContext): Declaration | null {
  const caretLine = ctx.lineOf(ctx.start)
  const onHeader = declarationAtLine(ctx.lines, ctx.masked, ctx.starts, ctx.profile, caretLine)
  if (onHeader && onHeader.kind === 'function') return onHeader
  return enclosingFunction(ctx.lines, ctx.masked, ctx.starts, ctx.profile, caretLine)
}

export function prepareChangeSignature(
  site: RefactorSite,
): SignaturePreparation | { ok: false; reason: string } {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const declaration = targetDeclaration(ctx)
  if (!declaration) return fail('Put the caret on a function or inside its body.')
  if (declaration.paramsStart < 0 || declaration.paramsEnd < 0) {
    return fail(`Could not read the parameter list of \`${declaration.name}\`.`)
  }

  const header = ctx.lines[declaration.line]
  const returnType =
    /\)\s*:\s*([^{=]+?)\s*[{=]?\s*$/.exec(header)?.[1]?.trim() ??
    /\)\s*->\s*([^{:]+?)\s*[{:]?\s*$/.exec(header)?.[1]?.trim() ??
    ''

  const all = parseParams(ctx.text, ctx.masked, declaration.paramsStart, declaration.paramsEnd)
  return {
    ok: true,
    functionName: declaration.name,
    // `self` is shown by no refactoring dialog worth using: it is not passed at
    // call sites, so it cannot be reordered or removed.
    params: all.filter((param) => !param.receiver),
    returnType,
    typeRequired: ctx.profile.typedParams,
    supportsDefaults: ctx.profile.supportsDefaultParams,
    declarationLine: declaration.line,
  }
}

export interface SignatureParam {
  name: string
  type?: string
  initializer?: string
  /** Position in the original list, or -1 when the parameter is new. */
  originalIndex: number
  /** Argument to insert at existing call sites for a new parameter. */
  callSiteValue?: string
}

export interface ChangeSignatureOptions {
  name: string
  returnType?: string
  params: SignatureParam[]
}

export async function changeSignature(
  site: RefactorSite,
  options: ChangeSignatureOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const declaration = targetDeclaration(ctx)
  if (!declaration) return fail('Put the caret on a function or inside its body.')
  if (declaration.paramsStart < 0 || declaration.paramsEnd < 0) {
    return fail(`Could not read the parameter list of \`${declaration.name}\`.`)
  }
  const nameError = validateName(options.name)
  if (nameError) return nameError
  for (const param of options.params) {
    const invalid = validateName(param.name)
    if (invalid) return fail(`Parameter: ${invalid.reason}`)
  }

  const all = parseParams(ctx.text, ctx.masked, declaration.paramsStart, declaration.paramsEnd)
  const receivers = all.filter((param) => param.receiver)
  // `originalIndex` counts positions the caller actually passes, so the
  // receiver is stripped before indexing and put back verbatim when rendering.
  const original = all.filter((param) => !param.receiver)
  const warnings: string[] = []
  const edits: TextEdit[] = []

  // 1. the parameter list
  const rendered = [
    ...receivers.map((param) => param.raw),
    ...options.params.map((p) => ctx.profile.param(p.name, p.type || undefined, p.initializer || undefined)),
  ].join(', ')
  edits.push({
    range: { start: ctx.positionOf(declaration.paramsStart), end: ctx.positionOf(declaration.paramsEnd) },
    newText: rendered,
  })

  // 2. renamed parameters, inside the body only
  const bodyFrom = ctx.starts[declaration.line + 1] ?? ctx.text.length
  const bodyTo = declaration.endLine + 1 < ctx.starts.length ? ctx.starts[declaration.endLine + 1] : ctx.text.length
  for (const param of options.params) {
    if (param.originalIndex < 0) continue
    const before = original[param.originalIndex]
    if (!before || before.name === param.name || !before.name) continue
    for (const offset of occurrences(ctx.masked, before.name, bodyFrom, bodyTo)) {
      edits.push({
        range: { start: ctx.positionOf(offset), end: ctx.positionOf(offset + before.name.length) },
        newText: param.name,
      })
    }
  }

  // 3. removed parameters that the body still uses
  const kept = new Set(options.params.map((p) => p.originalIndex))
  for (let index = 0; index < original.length; index++) {
    if (kept.has(index)) continue
    const name = original[index].name
    if (!name) continue
    if (occurrences(ctx.masked, name, bodyFrom, bodyTo).length > 0) {
      warnings.push(`The body still references \`${name}\`, which is being removed from the signature.`)
    }
  }

  // 4. the declaration's own name
  const renamed = options.name !== declaration.name
  if (renamed) {
    const nameOffset = ctx.text.indexOf(declaration.name, declaration.headerStart)
    if (nameOffset !== -1 && nameOffset < declaration.headerEnd) {
      edits.push({
        range: { start: ctx.positionOf(nameOffset), end: ctx.positionOf(nameOffset + declaration.name.length) },
        newText: options.name,
      })
    }
  }

  // 5. return type
  if (options.returnType !== undefined) {
    const change = returnTypeEdit(ctx, declaration, options.returnType)
    if (change) edits.push(change)
  }

  const changes: Record<string, TextEdit[]> = { [site.file]: edits }

  // 6. every call site
  const references = await workspace.references(declaration.name, site.file)
  const files = [...new Set(references.filter((r) => r.kind === 'code').map((r) => r.file))]
  let rewritten = 0

  for (const file of files) {
    const text = file === site.file ? ctx.text : await workspace.readFile(file)
    if (text === null) continue
    const language = file === site.file ? site.language : languageForPath(file)
    const fileCtx = analyze({ file, language, text, range: ZERO_RANGE })
    if (isFailure(fileCtx)) continue

    const declarationLines = new Set(
      file === site.file
        ? [declaration.line]
        : references.filter((r) => r.file === file && r.kind === 'declaration').map((r) => r.line - 1),
    )
    const { calls, unparsed } = findCallSites(
      file,
      text,
      fileCtx.masked,
      declaration.name,
      (line) => declarationLines.has(line),
      (offset) => fileCtx.lineOf(offset),
    )
    if (unparsed.length) {
      warnings.push(`${shortName(file)}: ${unparsed.length} call(s) could not be parsed and were left alone.`)
    }

    for (const call of calls) {
      const args = call.args.map((a) => a.text.trim())
      const next: string[] = []
      let missing = false
      for (const param of options.params) {
        if (param.originalIndex >= 0) {
          const existing = args[param.originalIndex]
          if (existing === undefined) {
            // The call relied on a default for this parameter; keep relying on it.
            continue
          }
          next.push(existing)
        } else if (param.callSiteValue) {
          next.push(param.callSiteValue)
        } else if (param.initializer && ctx.profile.supportsDefaultParams) {
          continue
        } else {
          missing = true
          next.push(param.initializer || placeholderFor(ctx))
        }
      }
      if (missing) {
        warnings.push(`${shortName(file)}:${call.line + 1} — no value given for a new parameter; a placeholder was inserted.`)
      }
      const fileEdits = changes[file] ?? []
      fileEdits.push({
        range: { start: fileCtx.positionOf(call.openParen + 1), end: fileCtx.positionOf(call.closeParen) },
        newText: next.join(', '),
      })
      if (renamed) {
        const start = call.openParen - declaration.name.length
        fileEdits.push({
          range: { start: fileCtx.positionOf(start), end: fileCtx.positionOf(start + declaration.name.length) },
          newText: options.name,
        })
      }
      changes[file] = fileEdits
      rewritten++
    }
  }

  if (rewritten === 0) warnings.push('No call sites were found — only the declaration changed.')

  return succeed(`Change Signature of “${declaration.name}”`, { changes }, warnings)
}

function returnTypeEdit(
  ctx: RefactorContext,
  declaration: Declaration,
  returnType: string,
): TextEdit | null {
  const header = ctx.lines[declaration.line]
  const closeParen = declaration.paramsEnd
  const afterParen = ctx.text.slice(closeParen + 1, declaration.headerEnd)

  const annotated = /^(\s*(?::|->)\s*)([^{=]+?)(\s*[{=]?\s*)$/.exec(afterParen)
  if (annotated) {
    const start = closeParen + 1 + annotated[1].length
    return {
      range: { start: ctx.positionOf(start), end: ctx.positionOf(start + annotated[2].length) },
      newText: returnType,
    }
  }
  if (!returnType) return null

  // No annotation yet: add one in whichever form the language uses.
  const separator = ctx.profile.id === 'python' || ctx.profile.id === 'rust' ? ' -> ' : ': '
  if (!['python', 'rust', 'typescript', 'typescriptreact', 'kotlin', 'scala', 'php', 'swift'].includes(ctx.profile.id)) {
    return null
  }
  return {
    range: { start: ctx.positionOf(closeParen + 1), end: ctx.positionOf(closeParen + 1) },
    newText: `${separator}${returnType}`.replace(/^ -> /, ' -> '),
  }
}

function placeholderFor(ctx: RefactorContext): string {
  switch (ctx.profile.id) {
    case 'python':
      return 'None'
    case 'go':
      return 'nil'
    case 'ruby':
      return 'nil'
    case 'rust':
      return 'Default::default()'
    case 'java':
    case 'kotlin':
    case 'csharp':
    case 'dart':
    case 'scala':
      return 'null'
    default:
      return 'null'
  }
}

function shortName(file: string) {
  return file.split('/').pop() ?? file
}

/* ================================================================== */
/* Introduce Parameter Object                                          */
/* ================================================================== */

export interface ParameterObjectOptions {
  typeName: string
  parameterName: string
  /** Indices into the original parameter list to fold into the object. */
  indices: number[]
}

export async function introduceParameterObject(
  site: RefactorSite,
  options: ParameterObjectOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const declaration = targetDeclaration(ctx)
  if (!declaration) return fail('Put the caret on a function or inside its body.')
  if (declaration.paramsStart < 0) return fail(`Could not read the parameter list of \`${declaration.name}\`.`)

  const nameError = validateName(options.typeName) ?? validateName(options.parameterName)
  if (nameError) return nameError

  const allParams = parseParams(ctx.text, ctx.masked, declaration.paramsStart, declaration.paramsEnd)
  const receivers = allParams.filter((param) => param.receiver)
  const params = allParams.filter((param) => !param.receiver)
  const chosen = options.indices.filter((i) => i >= 0 && i < params.length)
  if (chosen.length < 2) return fail('Select at least two parameters to fold into an object.')

  const fields = chosen.map((i) => ({ name: params[i].name, type: params[i].type || undefined }))
  const edits: TextEdit[] = []
  const warnings: string[] = []

  // 1. the new type, above the function
  const typeLines = ctx.profile.parameterObject(options.typeName, fields)
  edits.push({
    range: { start: { line: declaration.line, character: 0 }, end: { line: declaration.line, character: 0 } },
    newText: `${typeLines.map((l) => (l ? declaration.indent + l : '')).join('\n')}\n\n`,
  })

  // 2. the parameter list
  const remaining = params
    .map((param, index) => ({ param, index }))
    .filter(({ index }) => !chosen.includes(index))
  const folded = ctx.profile.param(options.parameterName, options.typeName)
  const insertAt = Math.min(...chosen)
  const rendered = [
    ...receivers.map((param) => param.raw),
    ...remaining.filter(({ index }) => index < insertAt).map(({ param }) => param.raw),
    folded,
    ...remaining.filter(({ index }) => index > insertAt).map(({ param }) => param.raw),
  ].join(', ')
  edits.push({
    range: { start: ctx.positionOf(declaration.paramsStart), end: ctx.positionOf(declaration.paramsEnd) },
    newText: rendered,
  })

  // 3. body references
  const bodyFrom = ctx.starts[declaration.line + 1] ?? ctx.text.length
  const bodyTo = declaration.endLine + 1 < ctx.starts.length ? ctx.starts[declaration.endLine + 1] : ctx.text.length
  for (const index of chosen) {
    const name = params[index].name
    if (!name) continue
    const access = ctx.profile.parameterObjectAccess(options.parameterName, name)
    for (const offset of occurrences(ctx.masked, name, bodyFrom, bodyTo)) {
      edits.push({
        range: { start: ctx.positionOf(offset), end: ctx.positionOf(offset + name.length) },
        newText: access,
      })
    }
  }

  const changes: Record<string, TextEdit[]> = { [site.file]: edits }

  // 4. call sites build the object
  const references = await workspace.references(declaration.name, site.file)
  const files = [...new Set(references.filter((r) => r.kind === 'code').map((r) => r.file))]
  let rewritten = 0

  for (const file of files) {
    const text = file === site.file ? ctx.text : await workspace.readFile(file)
    if (text === null) continue
    const language = file === site.file ? site.language : languageForPath(file)
    const fileCtx = analyze({ file, language, text, range: ZERO_RANGE })
    if (isFailure(fileCtx)) continue

    const declarationLines = new Set(file === site.file ? [declaration.line] : [])
    const { calls } = findCallSites(
      file,
      text,
      fileCtx.masked,
      declaration.name,
      (line) => declarationLines.has(line),
      (offset) => fileCtx.lineOf(offset),
    )

    for (const call of calls) {
      const args = call.args.map((a) => a.text.trim())
      if (args.length !== params.length) {
        warnings.push(`${shortName(file)}:${call.line + 1} — ${args.length} argument(s) for ${params.length} parameter(s); left alone.`)
        continue
      }
      const literal = ctx.profile.parameterObjectLiteral(
        options.typeName,
        chosen.map((i) => ({ name: params[i].name, value: args[i] })),
      )
      const next = [
        ...args.filter((_a, i) => !chosen.includes(i) && i < insertAt),
        literal,
        ...args.filter((_a, i) => !chosen.includes(i) && i > insertAt),
      ]
      changes[file] = [
        ...(changes[file] ?? []),
        {
          range: { start: fileCtx.positionOf(call.openParen + 1), end: fileCtx.positionOf(call.closeParen) },
          newText: next.join(', '),
        },
      ]
      rewritten++
    }
  }

  if (ctx.profile.id === 'python') {
    warnings.push('`@dataclass` and `Any` may need importing from `dataclasses` / `typing`.')
  }
  if (rewritten === 0) warnings.push('No call sites were found — only the declaration changed.')

  return succeed(`Introduce Parameter Object “${options.typeName}”`, { changes }, warnings)
}
