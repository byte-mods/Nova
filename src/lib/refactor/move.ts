/**
 * Move File and Move Class, with import updating.
 *
 * Import rewriting is real for the two module systems that can be resolved
 * from paths alone — relative specifiers (TypeScript/JavaScript) and dotted
 * module paths (Python). Every other language still gets the move, plus a
 * warning saying its imports were left alone, rather than a silent rename that
 * quietly breaks the build.
 */

import { languageForPath } from '../../../shared/languages'
import { basename, dirname, joinPath } from '../paths'
import { analyze, isFailure } from './context'
import { allClasses, dedent, lineRange, maskLiterals, occurrences } from './syntax'
import { profileFor } from './profiles'
import {
  fail,
  succeed,
  type RefactorResult,
  type RefactorSite,
  type RefactorWorkspace,
  type TextEdit,
} from './types'

const ZERO_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }

/** Languages whose imports this engine can recompute. */
export const RELATIVE_IMPORTS = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact'])
export const DOTTED_IMPORTS = new Set(['python'])

/* ---------------- path arithmetic ---------------- */

export function normalize(path: string): string {
  const absolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
      continue
    }
    parts.push(part)
  }
  return (absolute ? '/' : '') + parts.join('/')
}

/** `./sibling` or `../up/one`, always with a leading dot. */
export function relativeSpecifier(fromDir: string, toFile: string): string {
  const from = normalize(fromDir).split('/').filter(Boolean)
  const to = normalize(toFile).split('/').filter(Boolean)
  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared++
  const up = from.length - shared
  const down = to.slice(shared)
  const parts = up > 0 ? [...Array(up).fill('..'), ...down] : ['.', ...down]
  return parts.join('/')
}

export function stripExtension(path: string) {
  return path.replace(/\.(tsx?|jsx?|mts|cts|mjs|cjs)$/, '')
}

/**
 * Same file, same string.
 *
 * On macOS `/tmp` and `/var` are symlinks into `/private`, so the same file
 * reaches the engine as both `/var/x` and `/private/var/x` depending on whether
 * it came from the index (resolved) or from a dialog (as typed). Comparing
 * those literally silently skips every import rewrite.
 */
export function canonical(path: string): string {
  return path.replace(/^\/private(\/(?:var|tmp|etc)\/)/, '$1')
}

/** Does `specifier`, resolved from `fromFile`, point at `target`? */
export function specifierPointsAt(fromFile: string, specifier: string, target: string): boolean {
  if (!specifier.startsWith('.')) return false
  const resolved = canonical(normalize(joinPath(dirname(fromFile), specifier)))
  const full = canonical(target)
  const stripped = stripExtension(full)
  return (
    resolved === stripped ||
    resolved === full ||
    resolved === `${stripped}/index` ||
    stripExtension(resolved) === stripped
  )
}

const SPECIFIER_PATTERNS = [
  /\bfrom\s*(['"])([^'"]+)\1/g,
  /\bimport\s*(['"])([^'"]+)\1/g,
  /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
  /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g,
]

export interface Specifier {
  value: string
  /** Offsets of the specifier text itself, without the quotes. */
  start: number
  end: number
}

export function specifiersIn(text: string): Specifier[] {
  const found: Specifier[] = []
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text))) {
      const value = match[2]
      const start = match.index + match[0].lastIndexOf(value)
      found.push({ value, start, end: start + value.length })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/** `src/app/orders.py` under `/root` → `src.app.orders`. */
export function dottedModule(root: string, file: string): string {
  const canonicalRoot = canonical(root)
  const canonicalFile = canonical(file)
  const relative = canonicalFile.startsWith(canonicalRoot)
    ? canonicalFile.slice(canonicalRoot.length)
    : canonicalFile
  return relative
    .replace(/^\/+/, '')
    .replace(/\.py$/, '')
    .replace(/\/__init__$/, '')
    .split('/')
    .filter(Boolean)
    .join('.')
}

/* ================================================================== */
/* Move File                                                           */
/* ================================================================== */

export interface MoveFileOptions {
  /** Absolute destination directory. */
  targetDir: string
  /** Optional new base name, defaults to the current one. */
  newName?: string
  /** Project root, needed for Python module paths. */
  root: string
  updateImports: boolean
}

export async function moveFile(
  site: RefactorSite,
  options: MoveFileOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const oldPath = site.file
  const name = options.newName?.trim() || basename(oldPath)
  const newPath = normalize(joinPath(options.targetDir, name))
  if (newPath === oldPath) return fail('The file is already in that folder.')
  if (!/^[^/]+$/.test(name)) return fail(`“${name}” is not a valid file name.`)

  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []
  const language = site.language

  if (options.updateImports) {
    if (RELATIVE_IMPORTS.has(language)) {
      const result = await rewriteRelativeImports(oldPath, newPath, site.text, workspace)
      Object.assign(changes, result.changes)
      warnings.push(...result.warnings)
    } else if (DOTTED_IMPORTS.has(language)) {
      const result = await rewriteDottedImports(oldPath, newPath, options.root, workspace)
      Object.assign(changes, result.changes)
      warnings.push(...result.warnings)
    } else {
      warnings.push(
        `Imports were not updated — the engine only recomputes them for TypeScript/JavaScript and Python. Check references to \`${basename(oldPath)}\` by hand.`,
      )
    }
  }

  return succeed(
    `Move ${basename(oldPath)} → ${relativeSpecifier(dirname(oldPath), newPath)}`,
    {
      changes: Object.keys(changes).length ? changes : undefined,
      documentChanges: [{ kind: 'rename', oldUri: oldPath, newUri: newPath }],
    },
    warnings,
  )
}

async function rewriteRelativeImports(
  oldPath: string,
  newPath: string,
  movedText: string,
  workspace: RefactorWorkspace,
): Promise<{ changes: Record<string, TextEdit[]>; warnings: string[] }> {
  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []
  const files = await workspace.files()
  const oldDir = dirname(oldPath)
  const newDir = dirname(newPath)

  for (const file of files) {
    if (!RELATIVE_IMPORTS.has(languageForPath(file))) continue
    const isMoved = canonical(file) === canonical(oldPath)
    const text = isMoved ? movedText : await workspace.readFile(file)
    if (text === null) continue

    const profile = profileFor(languageForPath(file))
    if (!profile) continue
    const masked = maskLiterals(text, profile)
    const edits: TextEdit[] = []

    for (const specifier of specifiersIn(text)) {
      if (!specifier.value.startsWith('.')) continue

      let next: string | null = null
      if (isMoved) {
        // Everything this file imports is now one directory away.
        const resolved = canonical(normalize(joinPath(oldDir, specifier.value)))
        if (resolved === stripExtension(canonical(newPath)) || resolved === canonical(newPath)) continue
        next = preserveExtension(specifier.value, relativeSpecifier(canonical(newDir), resolved))
      } else if (specifierPointsAt(file, specifier.value, oldPath)) {
        next = preserveExtension(
          specifier.value,
          relativeSpecifier(canonical(dirname(file)), stripExtension(canonical(newPath))),
        )
      }

      if (next === null || next === specifier.value) continue
      edits.push({
        range: {
          start: positionIn(text, specifier.start),
          end: positionIn(text, specifier.end),
        },
        newText: next,
      })
    }

    if (edits.length) changes[file] = edits
    void masked
  }

  const touched = Object.keys(changes).filter((f) => f !== oldPath).length
  if (touched === 0) warnings.push('No other file imports this one by a relative path.')
  return { changes, warnings }
}

/** Keeps an explicit `.js`/`.ts` suffix if the original specifier had one. */
export function preserveExtension(original: string, next: string): string {
  const suffix = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/.exec(original)
  if (!suffix) return stripExtension(next)
  return `${stripExtension(next)}${suffix[0]}`
}

async function rewriteDottedImports(
  oldPath: string,
  newPath: string,
  root: string,
  workspace: RefactorWorkspace,
): Promise<{ changes: Record<string, TextEdit[]>; warnings: string[] }> {
  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []
  const oldModule = dottedModule(root, oldPath)
  const newModule = dottedModule(root, newPath)
  if (!oldModule) {
    return { changes, warnings: ['Could not work out the module path — imports were left alone.'] }
  }

  const profile = profileFor('python')!
  for (const file of await workspace.files()) {
    if (languageForPath(file) !== 'python' || file === oldPath) continue
    const text = await workspace.readFile(file)
    if (text === null) continue
    const masked = maskLiterals(text, profile)
    const edits: TextEdit[] = []
    for (const offset of occurrences(masked, oldModule)) {
      const before = text.slice(Math.max(0, offset - 60), offset)
      if (!/(from|import)\s+[\w.]*$/.test(before)) continue
      edits.push({
        range: { start: positionIn(text, offset), end: positionIn(text, offset + oldModule.length) },
        newText: newModule,
      })
    }
    if (edits.length) changes[file] = edits
  }

  if (Object.keys(changes).length === 0) {
    warnings.push(`No module imports \`${oldModule}\`.`)
  }
  return { changes, warnings }
}

export function positionIn(text: string, offset: number) {
  let line = 0
  let last = 0
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++
      last = i + 1
    }
  }
  return { line, character: offset - last }
}

/* ================================================================== */
/* Move Class                                                          */
/* ================================================================== */

export interface MoveClassPreparation {
  ok: true
  className: string
  from: number
  to: number
  /** Files that reference the class and may need their import updated. */
  referencingFiles: string[]
}

export async function prepareMoveClass(
  site: RefactorSite,
  workspace: RefactorWorkspace,
): Promise<MoveClassPreparation | { ok: false; reason: string }> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const caretLine = ctx.lineOf(ctx.start)
  const cls = allClasses(ctx.lines, ctx.masked, ctx.starts, ctx.profile).find(
    (c) => caretLine >= c.line && caretLine <= c.endLine,
  )
  if (!cls) return fail('Put the caret inside the class you want to move.')

  const references = await workspace.references(cls.name, site.file)
  return {
    ok: true,
    className: cls.name,
    from: cls.line,
    to: cls.endLine,
    referencingFiles: [...new Set(references.filter((r) => r.file !== site.file).map((r) => r.file))],
  }
}

export interface MoveClassOptions {
  /** Absolute path of the destination file; created when absent. */
  targetFile: string
  root: string
}

export async function moveClass(
  site: RefactorSite,
  options: MoveClassOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const ctx = analyze(site)
  if (isFailure(ctx)) return ctx
  const caretLine = ctx.lineOf(ctx.start)
  const cls = allClasses(ctx.lines, ctx.masked, ctx.starts, ctx.profile).find(
    (c) => caretLine >= c.line && caretLine <= c.endLine,
  )
  if (!cls) return fail('Put the caret inside the class you want to move.')
  if (options.targetFile === site.file) return fail('Choose a different file to move the class into.')

  const selected = ctx.lines.slice(cls.line, cls.endLine + 1)
  const { lines: classLines } = dedent(selected)
  const existing = await workspace.readFile(options.targetFile)
  const creating = existing === null

  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []

  // Remove from the source file.
  changes[site.file] = [{ range: lineRange(ctx.text, cls.line, cls.endLine), newText: '' }]

  // Append to the target file.
  const targetText = existing ?? ''
  const targetLines = targetText ? targetText.split('\n') : []
  const appendAt = targetLines.length
  const separator = targetText.trim() ? '\n' : ''
  changes[options.targetFile] = [
    {
      range: { start: { line: appendAt, character: 0 }, end: { line: appendAt, character: 0 } },
      newText: `${separator}${classLines.join('\n')}\n`,
    },
  ]

  // The source file may still use the class.
  const remaining = ctx.lines
    .filter((_line, index) => index < cls.line || index > cls.endLine)
    .join('\n')
  const stillUsed = occurrences(maskLiterals(remaining, ctx.profile), cls.name).length > 0
  if (stillUsed) {
    const statement = importStatementFor(ctx.site.language, site.file, options.targetFile, cls.name, options.root)
    if (statement) {
      changes[site.file].push({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: `${statement}\n`,
      })
    } else {
      warnings.push(`${basename(site.file)} still uses \`${cls.name}\` — add the import by hand.`)
    }
  }

  const references = await workspace.references(cls.name, site.file)
  const others = [...new Set(references.filter((r) => r.file !== site.file && r.kind === 'import').map((r) => r.file))]
  if (others.length) {
    warnings.push(
      `${others.length} file(s) import \`${cls.name}\` from its old module: ${others.map(basename).join(', ')}. Their import paths were not changed.`,
    )
  }

  return succeed(
    `Move Class “${cls.name}” → ${basename(options.targetFile)}`,
    {
      changes,
      documentChanges: creating
        ? [{ kind: 'create', uri: options.targetFile, options: { ignoreIfExists: true } }]
        : undefined,
    },
    warnings,
  )
}

function importStatementFor(
  language: string,
  fromFile: string,
  targetFile: string,
  name: string,
  root: string,
): string | null {
  if (RELATIVE_IMPORTS.has(language)) {
    return `import { ${name} } from '${stripExtension(relativeSpecifier(dirname(fromFile), targetFile))}'`
  }
  if (DOTTED_IMPORTS.has(language)) {
    const module = dottedModule(root, targetFile)
    return module ? `from ${module} import ${name}` : null
  }
  return null
}
