/**
 * Class-shaped refactorings: Extract Interface, Extract Superclass and
 * Convert Anonymous to Inner.
 *
 * All three synthesise a *type*, which is more than the extract/inline family
 * needs, so each language contributes a small `TypeShape`: how it spells an
 * interface, how a member signature is written inside one, and how a class
 * declares that it conforms. A language with no shape gets a clear refusal
 * rather than Java syntax pasted into a Ruby file.
 */

import { analyze, isFailure, type RefactorContext } from './context'
import {
  allClasses,
  allFunctions,
  dedent,
  indentOf,
  lineRange,
  matchForward,
  wordAtOffset,
  type Declaration,
} from './syntax'
import {
  fail,
  succeed,
  type RefactorResult,
  type RefactorSite,
  type TextEdit,
} from './types'

/* ---------------- per-language type synthesis ---------------- */

export interface MemberSignature {
  name: string
  /** Parameter list exactly as written in the source, without the parentheses. */
  params: string
  returnType: string
  /** True for a field rather than a method. */
  isField: boolean
  /** The raw declaration line, used when a member is moved wholesale. */
  raw: string
  from: number
  to: number
}

interface TypeShape {
  /** Opening line of the extracted interface/protocol/trait. */
  open: (name: string) => string
  /** One member inside it. */
  member: (member: MemberSignature) => string
  /** Closing line, or null when indentation closes the block. */
  close: string | null
  /** How a class says it conforms. */
  conform: 'implements' | 'extends' | 'colon' | 'python-base' | 'none'
  /** Opening line when extracting a *superclass* rather than an interface. */
  openClass: (name: string) => string
  /** Extra note shown in the preview for languages where conformance is manual. */
  note?: string
}

const SHAPES: Record<string, TypeShape> = {
  typescript: {
    open: (n) => `export interface ${n} {`,
    member: (m) =>
      m.isField ? `  ${m.name}: ${m.returnType || 'unknown'}` : `  ${m.name}(${m.params})${m.returnType ? `: ${m.returnType}` : ''}`,
    close: '}',
    conform: 'implements',
    openClass: (n) => `export abstract class ${n} {`,
  },
  javascript: {
    open: (n) => `/** @interface ${n} */\nexport class ${n} {`,
    member: (m) => (m.isField ? `  ${m.name}` : `  ${m.name}(${m.params}) {}`),
    close: '}',
    conform: 'extends',
    openClass: (n) => `export class ${n} {`,
    note: 'JavaScript has no interfaces — a base class was generated instead.',
  },
  java: {
    open: (n) => `interface ${n} {`,
    member: (m) => (m.isField ? `    ${m.raw.trim()}` : `    ${m.returnType || 'void'} ${m.name}(${m.params});`),
    close: '}',
    conform: 'implements',
    openClass: (n) => `abstract class ${n} {`,
  },
  kotlin: {
    open: (n) => `interface ${n} {`,
    member: (m) =>
      m.isField ? `    val ${m.name}: ${m.returnType || 'Any'}` : `    fun ${m.name}(${m.params})${m.returnType ? `: ${m.returnType}` : ''}`,
    close: '}',
    conform: 'colon',
    openClass: (n) => `abstract class ${n} {`,
  },
  csharp: {
    open: (n) => `interface ${n}\n{`,
    member: (m) => (m.isField ? `    ${m.returnType || 'object'} ${m.name} { get; }` : `    ${m.returnType || 'void'} ${m.name}(${m.params});`),
    close: '}',
    conform: 'colon',
    openClass: (n) => `abstract class ${n}\n{`,
  },
  go: {
    open: (n) => `type ${n} interface {`,
    member: (m) => `\t${m.name}(${m.params})${m.returnType ? ` ${m.returnType}` : ''}`,
    close: '}',
    conform: 'none',
    openClass: (n) => `type ${n} struct {`,
    note: 'Go interfaces are satisfied structurally — no declaration on the type is needed.',
  },
  python: {
    open: (n) => `class ${n}(Protocol):`,
    member: (m) =>
      m.isField ? `    ${m.name}: ${m.returnType || 'Any'}` : `    def ${m.name}(${m.params})${m.returnType ? ` -> ${m.returnType}` : ''}: ...`,
    close: null,
    conform: 'python-base',
    openClass: (n) => `class ${n}:`,
    note: 'Add `from typing import Protocol` if it is not imported yet.',
  },
  swift: {
    open: (n) => `protocol ${n} {`,
    member: (m) =>
      m.isField ? `    var ${m.name}: ${m.returnType || 'Any'} { get }` : `    func ${m.name}(${m.params})${m.returnType ? ` -> ${m.returnType}` : ''}`,
    close: '}',
    conform: 'colon',
    openClass: (n) => `class ${n} {`,
  },
  php: {
    open: (n) => `interface ${n} {`,
    member: (m) => `    public function ${m.name}(${m.params})${m.returnType ? `: ${m.returnType}` : ''};`,
    close: '}',
    conform: 'implements',
    openClass: (n) => `abstract class ${n} {`,
  },
  dart: {
    open: (n) => `abstract class ${n} {`,
    member: (m) => (m.isField ? `  ${m.returnType || 'dynamic'} get ${m.name};` : `  ${m.returnType || 'void'} ${m.name}(${m.params});`),
    close: '}',
    conform: 'implements',
    openClass: (n) => `abstract class ${n} {`,
  },
  scala: {
    open: (n) => `trait ${n} {`,
    member: (m) =>
      m.isField ? `  def ${m.name}: ${m.returnType || 'Any'}` : `  def ${m.name}(${m.params})${m.returnType ? `: ${m.returnType}` : ''}`,
    close: '}',
    conform: 'extends',
    openClass: (n) => `abstract class ${n} {`,
  },
  rust: {
    open: (n) => `pub trait ${n} {`,
    member: (m) => `    fn ${m.name}(${m.params})${m.returnType ? ` -> ${m.returnType}` : ''};`,
    close: '}',
    conform: 'none',
    openClass: (n) => `pub struct ${n} {`,
    note: 'Rust needs an `impl Trait for Type` block — one was not generated.',
  },
}

function shapeFor(language: string): TypeShape | null {
  return SHAPES[language] ?? SHAPES[language.replace(/react$/, '')] ?? null
}

/* ---------------- signature reading ---------------- */

/** Best-effort return type, read from whatever side of the name the language puts it. */
export function returnTypeOf(header: string, name: string, languageId: string): string {
  const id = languageId.replace(/react$/, '')
  const afterParams = /\)\s*(?::|->)\s*([^{=;]+)/.exec(header)
  if (['typescript', 'javascript', 'kotlin', 'scala', 'swift', 'rust', 'python', 'php'].includes(id)) {
    return afterParams ? afterParams[1].trim() : ''
  }
  if (id === 'go') {
    const tail = /\)\s*([\w\[\]\*\.]+)\s*\{/.exec(header)
    return tail ? tail[1].trim() : ''
  }
  // Type-before-name languages: everything between the modifiers and the name.
  const before = new RegExp(`([\\w.<>\\[\\], ]+?)\\s+${name}\\s*\\(`).exec(header)
  if (!before) return ''
  const words = before[1].trim().split(/\s+/)
  const modifiers = new Set([
    'public', 'private', 'protected', 'internal', 'static', 'final', 'abstract',
    'synchronized', 'native', 'default', 'virtual', 'override', 'sealed', 'async', 'const',
  ])
  const kept = words.filter((w) => !modifiers.has(w))
  return kept.join(' ')
}

/** Methods declared directly inside `cls`, ignoring nested classes. */
export function methodsOf(ctx: RefactorContext, cls: Declaration): MemberSignature[] {
  return allFunctions(ctx.lines, ctx.masked, ctx.starts, ctx.profile)
    .filter((fn) => fn.line > cls.line && fn.endLine <= cls.endLine)
    .map((fn) => ({
      name: fn.name,
      params: stripReceiver(
        fn.paramsStart >= 0 && fn.paramsEnd > fn.paramsStart
          ? ctx.text.slice(fn.paramsStart, fn.paramsEnd).replace(/\s+/g, ' ').trim()
          : '',
        ctx.profile.implicitSelfParam,
      ),
      returnType: returnTypeOf(ctx.lines[fn.line], fn.name, ctx.profile.id),
      isField: false,
      raw: ctx.lines[fn.line],
      from: fn.line,
      to: fn.endLine,
    }))
}

function stripReceiver(params: string, receiver: string | null): string {
  if (!receiver) return params
  const pattern = new RegExp(`^\\s*${receiver.replace(/[&*]/g, '\\$&')}\\s*,?\\s*`)
  return params.replace(pattern, '')
}

/** Lines inside the class body that look like field declarations. */
export function fieldsOf(ctx: RefactorContext, cls: Declaration): MemberSignature[] {
  const methodLines = new Set<number>()
  for (const method of methodsOf(ctx, cls)) {
    for (let line = method.from; line <= method.to; line++) methodLines.add(line)
  }
  const fields: MemberSignature[] = []
  for (let line = cls.line + 1; line <= cls.endLine; line++) {
    if (methodLines.has(line)) continue
    const text = ctx.lines[line]
    const trimmed = text.trim()
    if (!trimmed || trimmed === '}' || trimmed === 'end' || trimmed.startsWith('}')) continue
    if (ctx.profile.lineComments.some((c) => trimmed.startsWith(c))) continue
    if (trimmed.includes('(')) continue
    const match =
      /^(?:(?:public|private|protected|internal|static|final|readonly|val|var|let|const|pub)\s+)*(?:[\w.<>\[\]]+\s+)?[$@]?([A-Za-z_][\w$]*)\s*[:=;]/.exec(
        trimmed,
      )
    if (!match) continue
    const typed = /:\s*([^=;]+)/.exec(trimmed)
    fields.push({
      name: match[1],
      params: '',
      returnType: typed ? typed[1].trim() : '',
      isField: true,
      raw: text,
      from: line,
      to: line,
    })
  }
  return fields
}

/* ================================================================== */
/* Extract Interface / Superclass                                      */
/* ================================================================== */

export interface ExtractTypePreparation {
  ok: true
  className: string
  suggestedName: string
  members: MemberSignature[]
  /** Rendered once, so the dialog can explain what a language cannot do. */
  note: string
  conforms: boolean
}

export function prepareExtractType(
  site: RefactorSite,
  kind: 'interface' | 'superclass',
): ExtractTypePreparation | { ok: false; reason: string } {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const shape = shapeFor(ctx.profile.id)
  if (!shape) {
    return fail(`Extract ${kind === 'interface' ? 'Interface' : 'Superclass'} is not supported for ${site.language}.`)
  }

  const caretLine = ctx.lineOf(ctx.start)
  const cls = allClasses(ctx.lines, ctx.masked, ctx.starts, ctx.profile).find(
    (c) => caretLine >= c.line && caretLine <= c.endLine,
  )
  if (!cls) return fail('Put the caret inside the class you want to extract from.')

  const members = [...fieldsOf(ctx, cls), ...methodsOf(ctx, cls)]
  if (members.length === 0) return fail(`\`${cls.name}\` has no members the engine can read.`)

  return {
    ok: true,
    className: cls.name,
    suggestedName: kind === 'interface' ? suggestInterfaceName(cls.name, ctx.profile.id) : `Abstract${cls.name}`,
    members,
    note: shape.note ?? '',
    conforms: shape.conform !== 'none',
  }
}

function suggestInterfaceName(className: string, languageId: string): string {
  if (languageId === 'csharp') return `I${className}`
  if (className.endsWith('Impl')) return className.slice(0, -4)
  return `${className}able`.replace(/eable$/, 'able')
}

export interface ExtractTypeOptions {
  name: string
  /** Names of the members to include. */
  members: string[]
  /** Where the new declaration goes; the same file when empty. */
  targetFile?: string
  /** Add the `implements`/`extends` clause to the original class. */
  updateDeclaration: boolean
  /** Superclass only: remove the moved members from the original class. */
  moveMembers?: boolean
}

export function extractType(
  site: RefactorSite,
  kind: 'interface' | 'superclass',
  options: ExtractTypeOptions,
): RefactorResult {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const shape = shapeFor(ctx.profile.id)
  if (!shape) return fail(`Not supported for ${site.language}.`)

  const name = options.name.trim()
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return fail(`“${options.name}” is not a valid type name.`)

  const caretLine = ctx.lineOf(ctx.start)
  const cls = allClasses(ctx.lines, ctx.masked, ctx.starts, ctx.profile).find(
    (c) => caretLine >= c.line && caretLine <= c.endLine,
  )
  if (!cls) return fail('Put the caret inside the class you want to extract from.')

  const available = [...fieldsOf(ctx, cls), ...methodsOf(ctx, cls)]
  const chosen = available.filter((m) => options.members.includes(m.name))
  if (chosen.length === 0) return fail('Select at least one member.')

  const warnings: string[] = []
  if (shape.note) warnings.push(shape.note)

  const body =
    kind === 'interface'
      ? chosen.map((m) => shape.member(m))
      : chosen.map((m) => dedent(ctx.lines.slice(m.from, m.to + 1)).lines.map((l) => (l ? `${ctx.indent}${l}` : '')).join('\n'))

  const declaration = [
    kind === 'interface' ? shape.open(name) : shape.openClass(name),
    ...body,
    ...(shape.close ? [shape.close] : []),
  ].join('\n')

  const changes: Record<string, TextEdit[]> = {}
  const documentChanges: { kind: 'create'; uri: string; options?: { ignoreIfExists?: boolean } }[] = []

  if (options.targetFile && options.targetFile !== site.file) {
    documentChanges.push({ kind: 'create', uri: options.targetFile, options: { ignoreIfExists: true } })
    changes[options.targetFile] = [
      { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: `${declaration}\n` },
    ]
    warnings.push(`\`${name}\` went into a new file — add the import to ${site.file.split('/').pop()} by hand.`)
  } else {
    changes[site.file] = [
      {
        range: { start: { line: cls.line, character: 0 }, end: { line: cls.line, character: 0 } },
        newText: `${declaration}\n\n`,
      },
    ]
  }

  if (options.updateDeclaration && shape.conform !== 'none') {
    const header = ctx.lines[cls.line]
    const updated = addConformance(header, name, shape.conform)
    if (updated && updated !== header) {
      changes[site.file] = [
        ...(changes[site.file] ?? []),
        {
          range: { start: { line: cls.line, character: 0 }, end: { line: cls.line, character: header.length } },
          newText: updated,
        },
      ]
    } else {
      warnings.push(`Could not rewrite the header of \`${cls.name}\` — add \`${name}\` to it by hand.`)
    }
  }

  if (kind === 'superclass' && options.moveMembers) {
    const spans = [...chosen].sort((a, b) => b.from - a.from)
    for (const member of spans) {
      changes[site.file] = [
        ...(changes[site.file] ?? []),
        { range: lineRange(ctx.text, member.from, member.to), newText: '' },
      ]
    }
  }

  return succeed(
    `Extract ${kind === 'interface' ? 'Interface' : 'Superclass'} “${name}” from ${cls.name}`,
    { changes, documentChanges: documentChanges.length ? documentChanges : undefined },
    warnings,
  )
}

/** Adds `name` to a class header's conformance list, however the language spells it. */
export function addConformance(
  header: string,
  name: string,
  style: TypeShape['conform'],
): string | null {
  if (style === 'python-base') {
    const withBases = /^(\s*class\s+[A-Za-z_]\w*\s*\()([^)]*)(\)\s*:.*)$/.exec(header)
    if (withBases) {
      const bases = withBases[2].trim()
      return `${withBases[1]}${bases ? `${bases}, ` : ''}${name}${withBases[3]}`
    }
    const bare = /^(\s*class\s+[A-Za-z_]\w*)(\s*:.*)$/.exec(header)
    return bare ? `${bare[1]}(${name})${bare[2]}` : null
  }

  const keyword = style === 'extends' ? 'extends' : 'implements'
  if (style === 'implements' || style === 'extends') {
    const existing = new RegExp(`\\b${keyword}\\s+([A-Za-z_$][\\w$.<>, ]*)`).exec(header)
    if (existing) {
      return header.replace(existing[0], `${keyword} ${existing[1].trim()}, ${name}`)
    }
    // Insert just before the body opener.
    const brace = header.indexOf('{')
    if (brace === -1) return `${header.trimEnd()} ${keyword} ${name}`
    return `${header.slice(0, brace).trimEnd()} ${keyword} ${name} ${header.slice(brace)}`
  }

  // `colon` — Kotlin/Swift/C#: `class Foo : A, B {`
  const colon = /^(\s*(?:[\w@]+\s+)*(?:class|struct|object|actor)\s+[A-Za-z_$][\w$]*(?:<[^>]*>)?(?:\([^)]*\))?)\s*(:\s*[^{]*)?(\{?.*)$/.exec(
    header,
  )
  if (!colon) return null
  const existing = (colon[2] ?? '').replace(/^:\s*/, '').trim()
  const list = existing ? `${existing}, ${name}` : name
  return `${colon[1]} : ${list}${colon[3] ? ` ${colon[3].trim()}` : ''}`
}

/* ================================================================== */
/* Convert Anonymous to Inner                                          */
/* ================================================================== */

interface AnonymousSite {
  /** Offsets of the whole `new Type(args) { … }` expression. */
  start: number
  end: number
  typeName: string
  args: string
  bodyOpen: number
  bodyClose: number
  /** Kotlin's `object : Type(args) { … }`. */
  kotlinObject: boolean
}

/** The anonymous class expression containing the caret, if there is one. */
function anonymousAt(ctx: RefactorContext): AnonymousSite | null {
  const mask = ctx.masked.mask
  const patterns: { regex: RegExp; kotlin: boolean }[] = [
    { regex: /\bnew\s+([A-Za-z_$][\w$.]*)\s*\(/g, kotlin: false },
    { regex: /\bobject\s*:\s*([A-Za-z_$][\w$.]*)\s*\(/g, kotlin: true },
  ]

  let best: AnonymousSite | null = null
  for (const { regex, kotlin } of patterns) {
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(mask))) {
      const open = match.index + match[0].length - 1
      const close = matchForward(mask, open)
      if (close === -1) continue
      let cursor = close + 1
      while (cursor < mask.length && /\s/.test(mask[cursor])) cursor++
      if (mask[cursor] !== '{') continue
      const bodyClose = matchForward(mask, cursor)
      if (bodyClose === -1) continue
      if (ctx.start < match.index || ctx.start > bodyClose) continue
      const candidate: AnonymousSite = {
        start: match.index,
        end: bodyClose + 1,
        typeName: match[1].split('.').pop() ?? match[1],
        args: ctx.text.slice(open + 1, close).trim(),
        bodyOpen: cursor,
        bodyClose,
        kotlinObject: kotlin,
      }
      // Innermost wins when the caret is inside nested anonymous classes.
      if (!best || candidate.start > best.start) best = candidate
    }
  }
  return best
}

export interface AnonymousPreparation {
  ok: true
  typeName: string
  suggestedName: string
  args: string
  bodyLines: number
}

export function prepareConvertAnonymous(
  site: RefactorSite,
): AnonymousPreparation | { ok: false; reason: string } {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const found = anonymousAt(ctx)
  if (!found) {
    return fail(
      'Put the caret inside an anonymous class — `new Type(…) { … }` or Kotlin’s `object : Type(…) { … }`.',
    )
  }
  return {
    ok: true,
    typeName: found.typeName,
    suggestedName: `${found.typeName}Impl`,
    args: found.args,
    bodyLines: ctx.lineOf(found.bodyClose) - ctx.lineOf(found.bodyOpen) + 1,
  }
}

export interface ConvertAnonymousOptions {
  name: string
  /** Nest the new class inside the enclosing class rather than beside it. */
  nested: boolean
}

export function convertAnonymousToInner(
  site: RefactorSite,
  options: ConvertAnonymousOptions,
): RefactorResult {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const found = anonymousAt(ctx)
  if (!found) return fail('Put the caret inside an anonymous class.')

  const name = options.name.trim()
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return fail(`“${options.name}” is not a valid class name.`)

  const id = ctx.profile.id.replace(/react$/, '')
  if (!['java', 'kotlin', 'typescript', 'javascript', 'csharp'].includes(id)) {
    return fail(`Convert Anonymous to Inner is not supported for ${site.language}.`)
  }

  const bodyText = ctx.text.slice(found.bodyOpen + 1, found.bodyClose)
  const bodyLines = dedent(bodyText.split('\n').filter((line, index, all) => index > 0 || line.trim() || all.length === 1)).lines

  const enclosing = ctx.cls
  const anchorLine = options.nested && enclosing ? enclosing.endLine : ctx.lineOf(found.start)
  const baseIndent = options.nested && enclosing ? enclosing.indent + ctx.indent : indentOf(ctx.lines[anchorLine])

  const header =
    id === 'kotlin'
      ? `${baseIndent}${options.nested ? 'inner ' : ''}class ${name}(${found.args ? '' : ''}) : ${found.typeName}${found.args ? `(${found.args})` : '()'} {`
      : id === 'typescript' || id === 'javascript'
        ? `${baseIndent}class ${name} extends ${found.typeName} {`
        : `${baseIndent}${options.nested ? 'private static ' : ''}class ${name} extends ${found.typeName} {`

  const declaration = [
    header,
    ...bodyLines.map((line) => (line ? `${baseIndent}${ctx.indent}${line}` : '')),
    `${baseIndent}}`,
  ].join('\n')

  const construction =
    id === 'kotlin' ? `${name}()` : `new ${name}(${found.args})`

  const edits: TextEdit[] = [
    {
      range: { start: ctx.positionOf(found.start), end: ctx.positionOf(found.end) },
      newText: construction,
    },
    {
      range: {
        start: { line: options.nested && enclosing ? anchorLine : anchorLine, character: 0 },
        end: { line: options.nested && enclosing ? anchorLine : anchorLine, character: 0 },
      },
      newText: `${declaration}\n\n`,
    },
  ]

  const warnings: string[] = []
  if (found.args && id !== 'kotlin') {
    warnings.push(
      `The constructor arguments (${found.args}) are passed straight through — add a constructor to \`${name}\` if the base class needs one.`,
    )
  }
  if (/\b(?:this|self)\b/.test(bodyText)) {
    warnings.push('The body references `this` — check that it still means what it did inside the anonymous class.')
  }
  const captured = capturedLocals(ctx, bodyText, found)
  if (captured.length) {
    warnings.push(
      `It captures ${captured.length} local(s) (${captured.slice(0, 5).join(', ')}) — pass them into the new class as constructor parameters.`,
    )
  }

  return succeed(`Convert Anonymous to Inner “${name}”`, { changes: { [site.file]: edits } }, warnings)
}

/** Locals declared in the enclosing function that the anonymous body mentions. */
function capturedLocals(ctx: RefactorContext, bodyText: string, found: AnonymousSite): string[] {
  if (!ctx.fn) return []
  const before = ctx.text.slice(ctx.starts[ctx.fn.line], found.start)
  const declared = new Set<string>()
  const pattern = /\b(?:let|const|var|val|final)\s+([A-Za-z_$][\w$]*)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(before))) declared.add(match[1])
  return [...declared].filter((name) => new RegExp(`\\b${name}\\b`).test(bodyText))
}
