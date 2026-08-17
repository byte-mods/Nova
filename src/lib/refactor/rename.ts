/**
 * Rename, without a language server.
 *
 * The other thirteen refactorings already run off the symbol index; Rename is
 * the one IntelliJ users reach for most, so it runs off the same two facts:
 * the index knows where a name is declared and which files mention it, and the
 * masking engine knows which of those mentions are code rather than comments or
 * string bodies.
 *
 * Two decisions make this trustworthy rather than a project-wide find/replace:
 *
 *  - **Scope is narrowed by default.** A name with no exported declaration, or
 *    whose only declarations live in the current file, is renamed inside that
 *    file alone. Locals and private helpers are the common case and they are
 *    exactly the ones a textual sweep would wreck.
 *  - **Offsets are recomputed, never trusted.** The index records line/column
 *    from the file as it was on disk. Matches are re-derived from the text the
 *    engine is about to rewrite, so an unsaved buffer cannot shift an edit onto
 *    the wrong token.
 *
 * Everything still lands in the standard preview before it is applied.
 */

import { languageForPath } from '../../../shared/languages'
import { basename, dirname, joinPath } from '../paths'
import { maskingProfileFor, profileFor } from './profiles'
import {
  lineStartsOf,
  maskLiterals,
  occurrences,
  positionAt,
  wordAtOffset,
  offsetAt,
} from './syntax'
import {
  canonical,
  normalize,
  positionIn,
  preserveExtension,
  relativeSpecifier,
  specifierPointsAt,
  specifiersIn,
  stripExtension,
  dottedModule,
  DOTTED_IMPORTS,
  RELATIVE_IMPORTS,
} from './move'
import {
  fail,
  succeed,
  type RefactorFailure,
  type RefactorResult,
  type RefactorSite,
  type RefactorWorkspace,
  type TextEdit,
} from './types'

/** One occurrence the rename would rewrite, located in the file's current text. */
export interface RenameMatch {
  file: string
  /** 0-based offset into the file text. */
  start: number
  end: number
  /** 0-based. */
  line: number
  preview: string
  kind: 'code' | 'soft'
}

export interface RenamePreparation {
  ok: true
  name: string
  /** Symbol kind from the index, or `''` when the name is not indexed. */
  kind: string
  /** Files that would be rewritten. */
  files: string[]
  /** Matches outside comments and string literals — always rewritten. */
  code: RenameMatch[]
  /** Matches inside comments and strings — rewritten only on request. */
  soft: RenameMatch[]
  /** True when the engine narrowed the rename to the declaring file. */
  fileLocal: boolean
  /** Why it narrowed, for the dialog's checkbox hint. */
  scopeReason: string
  /** Suggested new file name when the file is named after the symbol. */
  renamesFile: boolean
  warnings: string[]
}

export interface RenameOptions {
  newName: string
  /** Also rewrite mentions inside comments and string literals. */
  searchInComments?: boolean
  /** Rewrite every file that mentions the name, ignoring the narrowing. */
  wholeProject?: boolean
  /** Rename the containing file to match, updating imports. */
  renameFile?: boolean
  /** Project root — only needed when `renameFile` is set for Python. */
  root?: string
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Rejects names the target language could not accept. */
export function validateIdentifier(name: string, language: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a new name.'
  if (!IDENTIFIER.test(trimmed)) return `“${trimmed}” is not a valid identifier.`
  const profile = profileFor(language)
  if (profile?.keywords.has(trimmed)) {
    return `“${trimmed}” is a keyword in ${profile.id} — pick another name.`
  }
  return null
}

/**
 * Every identifier-boundary occurrence of `name` in `text`, split by whether it
 * survives literal masking. A masked hit is inside a comment or a string.
 */
export function matchesIn(file: string, text: string, name: string): { code: RenameMatch[]; soft: RenameMatch[] } {
  const profile = maskingProfileFor(languageForPath(file))
  const masked = maskLiterals(text, profile)
  const starts = lineStartsOf(text)
  const live = new Set(occurrences(masked, name))

  const code: RenameMatch[] = []
  const soft: RenameMatch[] = []
  // `occurrences` on an unmasked copy gives every textual hit; the difference
  // between the two sets is precisely the comment and string mentions.
  const all = occurrences({ mask: text, text }, name)
  for (const start of all) {
    const line = positionAt(text, start, starts).line
    const match: RenameMatch = {
      file,
      start,
      end: start + name.length,
      line,
      preview: (text.split('\n')[line] ?? '').trim().slice(0, 200),
      kind: live.has(start) ? 'code' : 'soft',
    }
    if (match.kind === 'code') code.push(match)
    else soft.push(match)
  }
  return { code, soft }
}

export async function prepareRename(
  site: RefactorSite,
  workspace: RefactorWorkspace,
  options?: { wholeProject?: boolean },
): Promise<RenamePreparation | RefactorFailure> {
  const text = site.text
  const starts = lineStartsOf(text)
  const caret = offsetAt(text, site.range.start, starts)
  const word = wordAtOffset(text, caret) ?? wordAtOffset(text, Math.max(0, caret - 1))
  if (!word) return fail('Put the caret on the symbol you want to rename.')
  const name = word.name

  const [definitions, references] = await Promise.all([
    workspace.definitions(name, site.file).catch(() => []),
    workspace.references(name, site.file).catch(() => []),
  ])
  const declared = definitions.filter((d) => d.name === name)
  const here = declared.filter((d) => d.file === site.file)

  /*
   * Narrowing. A name the index never saw declared is almost always a local or
   * a parameter — those are not indexed — so the safe reading is "this file
   * only". A declaration that exists but is not exported is private to its
   * file by construction. Anything else is project-wide.
   */
  let fileLocal = false
  let scopeReason = ''
  if (options?.wholeProject) {
    fileLocal = false
    scopeReason = 'renaming across the whole project'
  } else if (declared.length === 0) {
    fileLocal = true
    scopeReason = 'no declaration is indexed under this name — treating it as a local'
  } else if (here.length > 0 && declared.every((d) => d.file === site.file && !d.exported)) {
    fileLocal = true
    scopeReason = 'the declaration is not exported'
  } else {
    scopeReason = `${declared.length} declaration(s) indexed under this name`
  }

  const candidateFiles = fileLocal
    ? [site.file]
    : [...new Set([site.file, ...references.map((r) => r.file)])]

  const code: RenameMatch[] = []
  const soft: RenameMatch[] = []
  for (const file of candidateFiles) {
    const fileText = file === site.file ? text : await workspace.readFile(file)
    if (fileText === null) continue
    const found = matchesIn(file, fileText, name)
    code.push(...found.code)
    soft.push(...found.soft)
  }

  if (code.length === 0) {
    return fail(`No occurrence of \`${name}\` survives literal masking — nothing to rename.`)
  }

  const warnings: string[] = []
  if (name.length <= 2) {
    warnings.push(
      `\`${name}\` is only ${name.length} character(s) long — read the preview carefully before applying.`,
    )
  }
  const otherDeclarations = declared.filter((d) => d.file !== site.file)
  if (!fileLocal && otherDeclarations.length > 0) {
    warnings.push(
      `${otherDeclarations.length} other file(s) also declare \`${name}\` (${otherDeclarations
        .slice(0, 3)
        .map((d) => `${basename(d.file)}:${d.line}`)
        .join(', ')}). Without a language server the engine cannot tell them apart.`,
    )
  }
  if (!fileLocal && new Set(code.map((m) => m.file)).size > 40) {
    warnings.push(`${new Set(code.map((m) => m.file)).size} files would change.`)
  }

  const stem = basename(site.file).replace(/\.[^.]+$/, '')
  return {
    ok: true,
    name,
    kind: declared[0]?.kind ?? '',
    files: [...new Set(code.map((m) => m.file))],
    code,
    soft,
    fileLocal,
    scopeReason,
    renamesFile: stem === name,
    warnings,
  }
}

export async function renameSymbol(
  site: RefactorSite,
  options: RenameOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const preparation = await prepareRename(site, workspace, { wholeProject: options.wholeProject })
  if (!preparation.ok) return preparation

  const invalid = validateIdentifier(options.newName, site.language)
  if (invalid) return fail(invalid)
  const newName = options.newName.trim()
  if (newName === preparation.name) return fail('The new name is the same as the old one.')

  const chosen = options.searchInComments
    ? [...preparation.code, ...preparation.soft]
    : preparation.code

  const changes: Record<string, TextEdit[]> = {}
  const texts = new Map<string, string>()
  for (const match of chosen) {
    let text = texts.get(match.file)
    if (text === undefined) {
      text = match.file === site.file ? site.text : ((await workspace.readFile(match.file)) ?? '')
      texts.set(match.file, text)
    }
    ;(changes[match.file] ??= []).push({
      range: { start: positionIn(text, match.start), end: positionIn(text, match.end) },
      newText: newName,
    })
  }

  const warnings = [...preparation.warnings]
  if (!options.searchInComments && preparation.soft.length) {
    warnings.push(
      `${preparation.soft.length} mention(s) in comments or strings were left untouched.`,
    )
  }

  if (options.renameFile && preparation.renamesFile) {
    const base = basename(site.file)
    const extension = base.slice(base.replace(/\.[^.]+$/, '').length)
    const target = joinPath(dirname(site.file), `${newName}${extension}`)
    const moved = await renamePath(site.file, target, options.root ?? '', workspace, site.text)
    // The resource op runs before any text edit, so edits aimed at the file
    // being renamed have to be re-keyed onto its new path or they miss.
    const merged = mergeChanges({ changes }, moved.changes)
    const own = merged.changes[site.file]
    delete merged.changes[site.file]
    if (own?.length) merged.changes[target] = [...(merged.changes[target] ?? []), ...own]
    warnings.push(...moved.warnings)
    return succeed(
      `Rename “${preparation.name}” to “${newName}” and its file`,
      {
        ...merged,
        documentChanges: [{ kind: 'rename', oldUri: site.file, newUri: target }],
      },
      warnings,
    )
  }

  const edit = { changes }
  const fileCount = Object.keys(changes).length
  return succeed(
    `Rename “${preparation.name}” to “${newName}”${fileCount > 1 ? ` in ${fileCount} files` : ''}`,
    edit,
    warnings,
  )
}

function mergeChanges(
  a: { changes: Record<string, TextEdit[]> },
  b: Record<string, TextEdit[]>,
): { changes: Record<string, TextEdit[]> } {
  const changes = { ...a.changes }
  for (const [file, edits] of Object.entries(b)) {
    changes[file] = [...(changes[file] ?? []), ...edits]
  }
  return { changes }
}

/* ================================================================== */
/* Rename File / Directory / Package                                   */
/* ================================================================== */

/**
 * Import rewriting for a set of moved paths.
 *
 * `moveFile` handles one file; renaming a directory moves every file beneath it
 * at once, and a specifier may need updating because its *target* moved, its
 * *source* moved, or both. Doing them together is the only way to get the
 * both-moved case right.
 */
export async function rewriteImportsForMoves(
  moves: Map<string, string>,
  workspace: RefactorWorkspace,
  root: string,
  overrides?: Map<string, string>,
): Promise<{ changes: Record<string, TextEdit[]>; warnings: string[] }> {
  const changes: Record<string, TextEdit[]> = {}
  const warnings: string[] = []
  const files = await workspace.files()
  const canonicalMoves = new Map<string, string>()
  for (const [from, to] of moves) canonicalMoves.set(canonical(from), to)

  let sawRelative = false
  let sawDotted = false

  for (const file of files) {
    const language = languageForPath(file)
    const isRelative = RELATIVE_IMPORTS.has(language)
    const isDotted = DOTTED_IMPORTS.has(language)
    if (!isRelative && !isDotted) continue

    const text = overrides?.get(file) ?? (await workspace.readFile(file))
    if (text === null || text === undefined) continue

    const movedTo = canonicalMoves.get(canonical(file))
    const effectiveDir = dirname(movedTo ?? file)
    const edits: TextEdit[] = []

    if (isRelative) {
      for (const specifier of specifiersIn(text)) {
        if (!specifier.value.startsWith('.')) continue
        // Where does this specifier point today?
        const resolvedFrom = dirname(file)
        let target: string | null = null
        for (const [from, to] of moves) {
          if (specifierPointsAt(file, specifier.value, from)) {
            target = to
            break
          }
        }
        if (target === null && movedTo === undefined) continue
        const absolute =
          target !== null
            ? canonical(stripExtension(target))
            : canonical(normalize(joinPath(resolvedFrom, specifier.value)))
        const next = preserveExtension(
          specifier.value,
          relativeSpecifier(canonical(effectiveDir), absolute),
        )
        if (next === specifier.value) continue
        edits.push({
          range: { start: positionIn(text, specifier.start), end: positionIn(text, specifier.end) },
          newText: next,
        })
        sawRelative = true
      }
    } else if (isDotted && root) {
      const profile = maskingProfileFor('python')
      const masked = maskLiterals(text, profile)
      for (const [from, to] of moves) {
        if (languageForPath(from) !== 'python') continue
        const oldModule = dottedModule(root, from)
        const newModule = dottedModule(root, to)
        if (!oldModule || oldModule === newModule) continue
        for (const offset of occurrences(masked, oldModule)) {
          const before = text.slice(Math.max(0, offset - 60), offset)
          if (!/(from|import)\s+[\w.]*$/.test(before)) continue
          edits.push({
            range: {
              start: positionIn(text, offset),
              end: positionIn(text, offset + oldModule.length),
            },
            newText: newModule,
          })
          sawDotted = true
        }
      }
    }

    if (edits.length) changes[file] = edits
  }

  if (!sawRelative && !sawDotted) {
    warnings.push('No import in the project pointed at the renamed path(s).')
  }
  return { changes, warnings }
}

/** Renames one file, recomputing the imports that pointed at it. */
export async function renamePath(
  from: string,
  to: string,
  root: string,
  workspace: RefactorWorkspace,
  currentText?: string,
): Promise<{ changes: Record<string, TextEdit[]>; warnings: string[] }> {
  const moves = new Map([[from, to]])
  const overrides = currentText === undefined ? undefined : new Map([[from, currentText]])
  return rewriteImportsForMoves(moves, workspace, root, overrides)
}

export interface RenameDirectoryOptions {
  /** Absolute path of the directory being renamed. */
  directory: string
  newName: string
  root: string
}

/**
 * Rename Directory — IntelliJ's Rename Package for languages whose package name
 * *is* the directory path.
 */
export async function renameDirectory(
  options: RenameDirectoryOptions,
  workspace: RefactorWorkspace,
): Promise<RefactorResult> {
  const directory = options.directory.replace(/\/+$/, '')
  const newName = options.newName.trim()
  if (!newName) return fail('Enter a new folder name.')
  if (/[/\\]/.test(newName)) return fail('A folder name cannot contain a path separator.')
  const target = joinPath(dirname(directory), newName)
  if (target === directory) return fail('That is already the folder’s name.')

  const files = await workspace.files()
  const prefix = `${directory}/`
  const inside = files.filter((file) => file.startsWith(prefix))
  if (inside.length === 0) {
    return fail(`No indexed file lives under ${basename(directory)} — nothing to update.`)
  }

  const moves = new Map<string, string>()
  for (const file of inside) moves.set(file, joinPath(target, file.slice(prefix.length)))

  const { changes, warnings } = await rewriteImportsForMoves(moves, workspace, options.root)

  return succeed(
    `Rename folder “${basename(directory)}” to “${newName}”`,
    {
      changes: Object.keys(changes).length ? changes : undefined,
      // One resource op: the OS rename moves the whole subtree atomically, and
      // per-file renames would race with the import edits above.
      documentChanges: [{ kind: 'rename', oldUri: directory, newUri: target }],
    },
    [`${inside.length} file(s) move with the folder.`, ...warnings],
  )
}
