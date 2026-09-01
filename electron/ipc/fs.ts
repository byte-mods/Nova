import { ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import type { DirEntry, FileReadResult, SearchHit } from '../../shared/types'
import { BINARY_EXT, IGNORED_DIRS, looksBinary, walk } from '../lib/scan'
import { clear as clearHistory, list as listHistory, read as readHistory, record } from '../lib/localHistory'
import { resolveEditorConfig } from '../lib/editorConfig'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
  /** Lets the symbol indexer keep up with on-disk edits. */
  onFileChanged?: (path: string) => void
}

/** The open project, used to scope local history. */
let projectRoot = ''

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
}

const MAX_TEXT_BYTES = 8 * 1024 * 1024

export function registerFsHandlers(ctx: Ctx) {
  ipcMain.handle('fs:list', async (_e, dir: string): Promise<DirEntry[]> => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const out: DirEntry[] = []
    for (const entry of entries) {
      // `.git` is noise in the tree and its contents are never editable here.
      if (entry.name === '.DS_Store' || entry.name === '.git') continue
      const full = path.join(dir, entry.name)
      const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && isDirSafe(full))
      let size: number | undefined
      if (!isDirectory) {
        try {
          size = (await fs.stat(full)).size
        } catch {
          size = 0
        }
      }
      out.push({ name: entry.name, path: full, isDirectory, size })
    }
    out.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
    return out
  })

  ipcMain.handle('fs:read', async (_e, file: string): Promise<FileReadResult> => {
    const stat = await fs.stat(file)
    const ext = path.extname(file).toLowerCase()

    // The size limit comes first, before the extension is consulted. It used to
    // be skipped for known-binary extensions, so a 2 GB archive was read whole
    // and base64-encoded — several times its size in memory — on the way to an
    // editor that could not have shown it anyway.
    if (stat.size > MAX_TEXT_BYTES) {
      return {
        path: file,
        // Deliberately empty rather than a placeholder line. A placeholder is
        // editable text, and saving it wrote that one line over the whole file.
        content: '',
        binary: BINARY_EXT.has(ext),
        encoding: 'utf8',
        mtimeMs: stat.mtimeMs,
        truncated: true,
        size: stat.size,
      }
    }

    const buf = await fs.readFile(file)
    if (BINARY_EXT.has(ext) || looksBinary(buf)) {
      const mime = MIME[ext] ?? 'application/octet-stream'
      return {
        path: file,
        content: `data:${mime};base64,${buf.toString('base64')}`,
        binary: true,
        encoding: 'base64',
        mtimeMs: stat.mtimeMs,
      }
    }
    return {
      path: file,
      content: buf.toString('utf8'),
      binary: false,
      encoding: 'utf8',
      mtimeMs: stat.mtimeMs,
    }
  })

  ipcMain.handle('fs:write', async (_e, file: string, content: string) => {
    // Snapshot what is on disk first, so every overwrite is recoverable —
    // including ones made by the AI console or a code action.
    if (projectRoot) {
      try {
        const previous = await fs.readFile(file, 'utf8')
        if (previous !== content) await record(projectRoot, file, previous)
      } catch {
        /* new file: nothing to snapshot */
      }
    }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, content, 'utf8')
  })

  /**
   * Canonical path with symlinks resolved. Git reports the resolved worktree
   * root (on macOS `/var` -> `/private/var`), so the project root must be
   * resolved too or absolute paths never compare equal.
   */
  ipcMain.handle('fs:realpath', async (_e, target: string) => {
    try {
      return await fs.realpath(target)
    } catch {
      return target
    }
  })

  // The code style a file should actually be formatted with, once the repo's
  // own `.editorconfig` has had its say.
  ipcMain.handle('editorconfig:resolve', (_e, file: string, root: string) =>
    resolveEditorConfig(file, root || projectRoot),
  )

  ipcMain.handle('history:list', (_e, file: string) => listHistory(projectRoot, file))
  ipcMain.handle('history:read', (_e, file: string, id: string) =>
    readHistory(projectRoot, file, id),
  )
  ipcMain.handle('history:clear', (_e, file: string) => clearHistory(projectRoot, file))

  ipcMain.handle('fs:create', async (_e, target: string, isDir: boolean) => {
    if (isDir) {
      await fs.mkdir(target, { recursive: true })
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true })
      const handle = await fs.open(target, 'wx')
      await handle.close()
    }
  })

  ipcMain.handle('fs:rename', async (_e, from: string, to: string) => {
    await fs.mkdir(path.dirname(to), { recursive: true })
    await fs.rename(from, to)
  })

  // Deletions go to the OS trash so they stay recoverable.
  ipcMain.handle('fs:trash', async (_e, target: string) => {
    await shell.trashItem(target)
  })

  ipcMain.handle('fs:exists', async (_e, target: string) => {
    try {
      await fs.access(target)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle(
    'fs:search',
    async (
      _e,
      root: string,
      query: string,
      opts?: { caseSensitive?: boolean; regex?: boolean; maxHits?: number },
    ): Promise<SearchHit[]> => {
      if (!query.trim()) return []
      const maxHits = opts?.maxHits ?? 500
      let matcher: RegExp
      try {
        matcher = opts?.regex
          ? new RegExp(query, opts.caseSensitive ? 'g' : 'gi')
          : new RegExp(escapeRegExp(query), opts?.caseSensitive ? 'g' : 'gi')
      } catch {
        return []
      }
      const hits: SearchHit[] = []
      for await (const file of walk(root, 30000)) {
        if (hits.length >= maxHits) break
        const ext = path.extname(file).toLowerCase()
        if (BINARY_EXT.has(ext)) continue
        let text: string
        try {
          const buf = await fs.readFile(file)
          if (buf.length > 2_000_000 || looksBinary(buf)) continue
          text = buf.toString('utf8')
        } catch {
          continue
        }
        if (!matcher.test(text)) continue
        matcher.lastIndex = 0
        const lines = text.split('\n')
        for (let i = 0; i < lines.length && hits.length < maxHits; i++) {
          matcher.lastIndex = 0
          const m = matcher.exec(lines[i])
          if (m) {
            hits.push({
              path: file,
              line: i + 1,
              column: m.index + 1,
              preview: lines[i].slice(0, 240),
            })
          }
        }
      }
      return hits
    },
  )

  // `limit` exists for the refactoring engine, which needs the whole tree to
  // recompute import paths, not just the palette's top matches.
  ipcMain.handle(
    'fs:findFiles',
    async (_e, root: string, query: string, limit = 60): Promise<string[]> => {
      const needle = query.toLowerCase().replace(/\s+/g, '')
      const cap = Math.max(1, Math.min(limit, 30000))
      const scored: { file: string; score: number }[] = []
      for await (const file of walk(root, 30000)) {
        const rel = path.relative(root, file)
        const score = needle ? fuzzyScore(rel.toLowerCase(), needle) : 1
        if (score > 0) scored.push({ file, score })
        if (scored.length > Math.max(4000, cap)) break
      }
      scored.sort((a, b) => b.score - a.score || a.file.length - b.file.length)
      return scored.slice(0, cap).map((s) => s.file)
    },
  )

  const watchers = new Map<string, fsSync.FSWatcher>()
  ipcMain.handle('fs:watch', async (_e, root: string) => {
    projectRoot = root
    for (const [key, w] of watchers) {
      w.close()
      watchers.delete(key)
    }
    try {
      const watcher = fsSync.watch(root, { recursive: true }, (_type, filename) => {
        if (!filename) return
        const name = filename.toString()
        if (name.split(path.sep).some((seg) => IGNORED_DIRS.has(seg))) return
        const full = path.join(root, name)
        ctx.onFileChanged?.(full)
        ctx.broadcast('fs:changed', { path: full })
      })
      watchers.set(root, watcher)
    } catch {
      // Recursive watching is unavailable on some platforms/filesystems; the UI
      // still works, it just refreshes on demand instead of automatically.
    }
  })
}

function isDirSafe(p: string) {
  try {
    return fsSync.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}


/** Subsequence match with a bonus for consecutive and boundary-aligned characters. */
function fuzzyScore(haystack: string, needle: string): number {
  let score = 0
  let hi = 0
  let streak = 0
  for (let ni = 0; ni < needle.length; ni++) {
    const ch = needle[ni]
    let found = -1
    for (let i = hi; i < haystack.length; i++) {
      if (haystack[i] === ch) {
        found = i
        break
      }
    }
    if (found === -1) return 0
    streak = found === hi ? streak + 1 : 0
    score += 1 + streak * 2
    if (found === 0 || '/-_. '.includes(haystack[found - 1])) score += 4
    hi = found + 1
  }
  return score
}
