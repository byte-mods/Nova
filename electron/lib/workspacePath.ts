/**
 * One containment check, used everywhere a path arrives from outside Nova.
 *
 * Four separate places had grown their own version of "resolve it and make sure
 * it is still under the project": the share server, the plugin host, the `.http`
 * data loader and the proto resolver. Each one resolved and compared, and each
 * one stopped there — which is the half that does not hold. `path.resolve`
 * collapses `..`, so it defeats a traversal *string*; it knows nothing about
 * symlinks, so `ln -s / link` inside the project produces a path that passes the
 * check and then reads anywhere on the machine.
 *
 * The fix has to be `realpath`, and `realpath` is why this is shared rather than
 * copied a fifth time: it is async, it fails on paths that do not exist yet, and
 * the root itself is usually a symlink (on macOS `/tmp` is `/private/tmp`), so
 * the root needs resolving too or every check fails closed. Getting that right
 * once is worth more than getting it approximately right in four files.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

/** Thrown when a path resolves outside the root it was supposed to stay in. */
export class PathEscapeError extends Error {
  readonly requested: string
  constructor(requested: string, detail = 'is outside the open project') {
    super(`Path "${requested}" ${detail}.`)
    this.name = 'PathEscapeError'
    this.requested = requested
  }
}

/** True when `child` is the same as `root` or sits beneath it. */
export function isInside(root: string, child: string): boolean {
  if (child === root) return true
  const rel = path.relative(root, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * The deepest ancestor of `target` that exists, with symlinks resolved.
 *
 * A path that does not exist yet cannot be `realpath`ed, but the question we
 * are asking still has an answer: whichever part of it *does* exist decides
 * where the rest of it would land. Walking up until something resolves and then
 * re-attaching the missing tail gives the real location of a file that has not
 * been created, which is what a write path needs to check before creating it.
 */
async function realpathDeepest(target: string): Promise<string> {
  const missing: string[] = []
  let current = target
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse())
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err
      const parent = path.dirname(current)
      // `dirname('/')` is `/`, so this is the filesystem root and nothing above
      // it resolved. Hand back what we were given rather than looping forever.
      if (parent === current) return path.join(current, ...missing.reverse())
      missing.push(path.basename(current))
      current = parent
    }
  }
}

export interface ResolveOptions {
  /**
   * Allow an absolute `requested` path, as long as it still lands inside the
   * root. Off by default: a caller reading a repository's own content has no
   * business naming `/etc/passwd`, and the callers that legitimately take
   * absolute paths (a coverage report describing its own source tree) say so.
   */
  allowAbsolute?: boolean
  /**
   * Resolve a relative `requested` against this directory instead of `root`.
   *
   * A `.http` file's `@data ./rows.csv` is relative to the file, not to the
   * project — but it still has to *land* in the project. Separating the two
   * keeps the ergonomics the author expects and the boundary the user does.
   */
  base?: string
}

/**
 * Resolves `requested` against `root` and proves the result is still inside it.
 *
 * Both sides go through `realpath`, so a symlink pointing out of the project
 * fails here rather than at the filesystem. Throws `PathEscapeError` on any
 * path that leaves the root; every other error (a permission failure on an
 * ancestor, say) propagates, because silently treating it as "outside" would
 * turn an unreadable directory into a containment bug report.
 */
export async function resolveInRoot(
  root: string,
  requested: string,
  options: ResolveOptions = {},
): Promise<string> {
  if (!requested) throw new PathEscapeError(requested, 'is empty')
  if (!options.allowAbsolute && path.isAbsolute(requested)) {
    throw new PathEscapeError(requested, 'must be relative to the open project')
  }
  // Reject before touching the filesystem when the string alone gives it away,
  // so an obvious traversal never causes a stat.
  const resolved = path.resolve(options.base ?? root, requested)
  if (!isInside(root, resolved)) throw new PathEscapeError(requested)

  const realRoot = await realpathDeepest(root)
  const realTarget = await realpathDeepest(resolved)
  if (!isInside(realRoot, realTarget)) throw new PathEscapeError(requested)
  return realTarget
}

/**
 * `resolveInRoot` for callers that would rather branch than catch.
 *
 * The share server answers with a status code and the plugin host throws, so
 * neither shape fits both. This one returns `null` and lets the caller decide.
 */
export async function tryResolveInRoot(
  root: string,
  requested: string,
  options: ResolveOptions = {},
): Promise<string | null> {
  try {
    return await resolveInRoot(root, requested, options)
  } catch (err) {
    if (err instanceof PathEscapeError) return null
    throw err
  }
}
