import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  Changelist,
  GitBlameLine,
  GitBranch,
  GitChange,
  GitCommit,
  GitFileStatus,
  GitStashEntry,
  GitStatus,
  MergeStages,
  RebaseStep,
  ShelfEntry,
} from '../../shared/types'

const exec = promisify(execFile)

/** Single-quotes a value for a `sh -c` fragment inside a rebase todo. */
function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function git(cwd: string, args: string[]) {
  const { stdout } = await exec('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  })
  return stdout
}

async function gitSafe(cwd: string, args: string[]) {
  try {
    return { ok: true, out: await git(cwd, args) }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, out: e.stderr || e.stdout || e.message || 'git failed' }
  }
}

function statusFromCode(code: string, staged: boolean): GitFileStatus {
  if (code === '??') return 'untracked'
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted'
  const letter = staged ? code[0] : code[1]
  switch (letter) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'added'
    case 'T':
      return 'modified'
    default:
      return 'unknown'
  }
}

/** Parses `git status --porcelain=v1 -z` into staged + unstaged change entries. */
function parseStatus(raw: string, root: string): GitChange[] {
  const changes: GitChange[] = []
  const parts = raw.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i]
    if (!entry) continue
    const code = entry.slice(0, 2)
    let file = entry.slice(3)
    let origPath: string | undefined
    if (code[0] === 'R' || code[0] === 'C') {
      // Renames encode the original path in the following NUL-separated field.
      origPath = parts[++i]
    }
    const abs = path.join(root, file)
    if (code === '??') {
      changes.push({ path: abs, status: 'untracked', staged: false, code })
      continue
    }
    if (code[0] !== ' ' && code[0] !== '?') {
      changes.push({
        path: abs,
        origPath: origPath ? path.join(root, origPath) : undefined,
        status: statusFromCode(code, true),
        staged: true,
        code,
      })
    }
    if (code[1] !== ' ' && code[1] !== '?') {
      changes.push({
        path: abs,
        origPath: origPath ? path.join(root, origPath) : undefined,
        status: statusFromCode(code, false),
        staged: false,
        code,
      })
    }
  }
  return changes
}

const LOG_SEP = '\x1e'
const LOG_FIELD = '\x1f'

export function registerGitHandlers() {
  ipcMain.handle('git:status', async (_e, cwd: string): Promise<GitStatus> => {
    const rootRes = await gitSafe(cwd, ['rev-parse', '--show-toplevel'])
    if (!rootRes.ok) {
      return {
        isRepo: false,
        branch: '',
        upstream: '',
        ahead: 0,
        behind: 0,
        changes: [],
        root: cwd,
      }
    }
    const root = rootRes.out.trim()
    const [branchRes, statusRes, upstreamRes] = await Promise.all([
      gitSafe(root, ['rev-parse', '--abbrev-ref', 'HEAD']),
      gitSafe(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
      gitSafe(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']),
    ])

    let ahead = 0
    let behind = 0
    if (upstreamRes.ok) {
      const counts = await gitSafe(root, [
        'rev-list',
        '--left-right',
        '--count',
        `${upstreamRes.out.trim()}...HEAD`,
      ])
      if (counts.ok) {
        const [b, a] = counts.out.trim().split(/\s+/).map(Number)
        behind = b || 0
        ahead = a || 0
      }
    }

    return {
      isRepo: true,
      branch: branchRes.ok ? branchRes.out.trim() : 'HEAD',
      upstream: upstreamRes.ok ? upstreamRes.out.trim() : '',
      ahead,
      behind,
      changes: statusRes.ok ? parseStatus(statusRes.out, root) : [],
      root,
    }
  })

  ipcMain.handle(
    'git:log',
    async (_e, cwd: string, limit = 200, branch?: string): Promise<GitCommit[]> => {
      // `%P` carries the parent hashes, which is what lets the renderer draw a
      // graph instead of a flat list.
      const format = ['%H', '%h', '%s', '%b', '%an', '%ae', '%at', '%D', '%P'].join(LOG_FIELD) + LOG_SEP
      const args = ['log', `--max-count=${limit}`, `--format=${format}`]
      if (branch) args.push(branch)
      else args.push('--all')
      const res = await gitSafe(cwd, args)
      if (!res.ok) return []
      return res.out
        .split(LOG_SEP)
        .map((chunk) => chunk.replace(/^\n/, ''))
        .filter((chunk) => chunk.trim().length > 0)
        .map((chunk) => {
          const [hash, shortHash, subject, body, author, email, date, refs, parents] =
            chunk.split(LOG_FIELD)
          return {
            hash,
            shortHash,
            subject,
            body: (body ?? '').trim(),
            author,
            email,
            date: Number(date) || 0,
            refs: refs ?? '',
            parents: (parents ?? '').trim().split(/\s+/).filter(Boolean),
          }
        })
    },
  )

  ipcMain.handle('git:commitFiles', async (_e, cwd: string, hash: string) => {
    const res = await gitSafe(cwd, [
      'show',
      '--name-status',
      '--format=',
      '--no-renames',
      hash,
    ])
    if (!res.ok) return []
    return res.out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [code, ...rest] = line.split('\t')
        return { path: rest.join('\t'), code }
      })
  })

  ipcMain.handle('git:diff', async (_e, cwd: string, file: string, staged: boolean) => {
    const rel = path.relative(cwd, file)
    const args = ['diff', '--no-color']
    if (staged) args.push('--cached')
    args.push('--', rel)
    const res = await gitSafe(cwd, args)
    if (res.ok && res.out.trim()) return res.out
    // Untracked files have no diff target; synthesise one against /dev/null.
    const untracked = await gitSafe(cwd, ['diff', '--no-color', '--no-index', '/dev/null', file])
    return untracked.out
  })

  ipcMain.handle('git:commitDiff', async (_e, cwd: string, hash: string, file?: string) => {
    const args = ['show', '--no-color', '--format=', hash]
    if (file) args.push('--', file)
    const res = await gitSafe(cwd, args)
    return res.out
  })

  ipcMain.handle('git:showFile', async (_e, cwd: string, rev: string, file: string) => {
    const rel = path.relative(cwd, file) || file
    const res = await gitSafe(cwd, ['show', `${rev}:${rel}`])
    return res.ok ? res.out : ''
  })

  ipcMain.handle('git:stage', async (_e, cwd: string, files: string[]) => {
    if (!files.length) return
    await gitSafe(cwd, ['add', '--', ...files.map((f) => path.relative(cwd, f))])
  })

  ipcMain.handle('git:unstage', async (_e, cwd: string, files: string[]) => {
    if (!files.length) return
    await gitSafe(cwd, ['restore', '--staged', '--', ...files.map((f) => path.relative(cwd, f))])
  })

  ipcMain.handle('git:discard', async (_e, cwd: string, files: string[]) => {
    for (const file of files) {
      const rel = path.relative(cwd, file)
      const tracked = await gitSafe(cwd, ['ls-files', '--error-unmatch', '--', rel])
      if (tracked.ok) await gitSafe(cwd, ['restore', '--worktree', '--', rel])
      else await gitSafe(cwd, ['clean', '-fd', '--', rel])
    }
  })

  ipcMain.handle('git:commit', async (_e, cwd: string, message: string, amend?: boolean) => {
    const args = ['commit', '-m', message]
    if (amend) args.push('--amend')
    const res = await gitSafe(cwd, args)
    return res.out
  })

  ipcMain.handle('git:branches', async (_e, cwd: string): Promise<GitBranch[]> => {
    const res = await gitSafe(cwd, [
      'for-each-ref',
      '--format=%(refname:short)%09%(HEAD)%09%(refname)',
      'refs/heads',
      'refs/remotes',
    ])
    if (!res.ok) return []
    return res.out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, head, refname] = line.split('\t')
        return { name, current: head === '*', remote: refname.startsWith('refs/remotes') }
      })
      .filter((b) => !b.name.endsWith('/HEAD'))
  })

  ipcMain.handle('git:checkout', async (_e, cwd: string, branch: string, create?: boolean) => {
    // The `--` matters: without it git resolves the argument as a *pathspec*
    // when no such branch exists, and `git checkout somefile` discards that
    // file's uncommitted changes. A branch list that has gone stale is enough
    // to turn a checkout into silent data loss.
    //
    // `-b` takes a branch name by definition, so the separator only belongs on
    // the switching form.
    await gitSafe(cwd, create ? ['checkout', '-b', branch] : ['checkout', branch, '--'])
  })

  ipcMain.handle('git:init', async (_e, cwd: string) => {
    await gitSafe(cwd, ['init'])
  })

  /** Line-by-line authorship, parsed from git's porcelain blame format. */
  ipcMain.handle('git:blame', async (_e, cwd: string, file: string): Promise<GitBlameLine[]> => {
    const res = await gitSafe(cwd, ['blame', '--line-porcelain', '--', path.relative(cwd, file)])
    if (!res.ok) return []

    const lines: GitBlameLine[] = []
    const meta = new Map<string, { author: string; date: number; summary: string }>()
    let current: { hash: string; line: number } | null = null
    let author = ''
    let time = 0
    let summary = ''

    for (const raw of res.out.split('\n')) {
      const header = /^([0-9a-f]{40})\s+\d+\s+(\d+)/.exec(raw)
      if (header) {
        current = { hash: header[1], line: Number(header[2]) }
        const cached = meta.get(header[1])
        author = cached?.author ?? ''
        time = cached?.date ?? 0
        summary = cached?.summary ?? ''
        continue
      }
      if (raw.startsWith('author ')) author = raw.slice(7)
      else if (raw.startsWith('author-time ')) time = Number(raw.slice(12))
      else if (raw.startsWith('summary ')) summary = raw.slice(8)
      else if (raw.startsWith('\t') && current) {
        meta.set(current.hash, { author, date: time, summary })
        lines.push({
          line: current.line,
          hash: current.hash,
          shortHash: current.hash.slice(0, 7),
          author,
          date: time,
          summary,
          /** All-zero hash is git's marker for an uncommitted line. */
          uncommitted: /^0+$/.test(current.hash),
        })
        current = null
      }
    }
    return lines
  })

  /** Commits that touched one file, for its own history view. */
  ipcMain.handle('git:fileHistory', async (_e, cwd: string, file: string, limit = 100) => {
    const format = ['%H', '%h', '%s', '%b', '%an', '%ae', '%at', '%D'].join(LOG_FIELD) + LOG_SEP
    const res = await gitSafe(cwd, [
      'log',
      `--max-count=${limit}`,
      `--format=${format}`,
      '--follow',
      '--',
      path.relative(cwd, file),
    ])
    if (!res.ok) return []
    return res.out
      .split(LOG_SEP)
      .map((chunk) => chunk.replace(/^\n/, ''))
      .filter((chunk) => chunk.trim())
      .map((chunk) => {
        const [hash, shortHash, subject, body, author, email, date, refs] = chunk.split(LOG_FIELD)
        return {
          hash,
          shortHash,
          subject,
          body: (body ?? '').trim(),
          author,
          email,
          date: Number(date) || 0,
          refs: refs ?? '',
        }
      })
  })

  ipcMain.handle('git:revert', (_e, cwd: string, hash: string) =>
    gitSafe(cwd, ['revert', '--no-edit', hash]),
  )
  ipcMain.handle('git:cherryPick', (_e, cwd: string, hash: string) =>
    gitSafe(cwd, ['cherry-pick', hash]),
  )
  ipcMain.handle('git:resetTo', (_e, cwd: string, hash: string, mode: string) =>
    gitSafe(cwd, ['reset', `--${mode}`, hash]),
  )

  ipcMain.handle('git:stash', (_e, cwd: string, message: string) =>
    gitSafe(cwd, message ? ['stash', 'push', '-u', '-m', message] : ['stash', 'push', '-u']),
  )
  ipcMain.handle('git:stashList', async (_e, cwd: string): Promise<GitStashEntry[]> => {
    const res = await gitSafe(cwd, ['stash', 'list', '--format=%gd%x1f%s%x1f%at'])
    if (!res.ok) return []
    return res.out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [ref, subject, at] = line.split('\x1f')
        return { ref, subject, date: Number(at) || 0 }
      })
  })
  ipcMain.handle('git:stashApply', (_e, cwd: string, ref: string, drop: boolean) =>
    gitSafe(cwd, drop ? ['stash', 'pop', ref] : ['stash', 'apply', ref]),
  )
  ipcMain.handle('git:stashDrop', (_e, cwd: string, ref: string) =>
    gitSafe(cwd, ['stash', 'drop', ref]),
  )

  ipcMain.handle('git:fetch', (_e, cwd: string) => gitSafe(cwd, ['fetch', '--all', '--prune']))
  ipcMain.handle('git:pull', (_e, cwd: string) => gitSafe(cwd, ['pull', '--ff-only']))
  ipcMain.handle('git:push', (_e, cwd: string, setUpstream?: boolean) =>
    gitSafe(cwd, setUpstream ? ['push', '-u', 'origin', 'HEAD'] : ['push']),
  )

  ipcMain.handle('git:raw', (_e, cwd: string, args: string[]) => gitSafe(cwd, args))

  /* ---------------- merge conflicts ---------------- */

  ipcMain.handle('git:conflicts', async (_e, cwd: string): Promise<string[]> => {
    const res = await gitSafe(cwd, ['diff', '--name-only', '--diff-filter=U'])
    if (!res.ok) return []
    return res.out.split('\n').filter(Boolean).map((rel) => path.join(cwd, rel))
  })

  /**
   * The three sides of a conflict.
   *
   * Git keeps them in the index at stages 1/2/3 for exactly this purpose, so a
   * three-way merge needs no re-running of the merge and no guessing from the
   * conflict markers in the working tree.
   */
  ipcMain.handle('git:mergeStages', async (_e, cwd: string, file: string): Promise<MergeStages> => {
    const rel = path.relative(cwd, file) || file
    const [base, ours, theirs] = await Promise.all([
      gitSafe(cwd, ['show', `:1:${rel}`]),
      gitSafe(cwd, ['show', `:2:${rel}`]),
      gitSafe(cwd, ['show', `:3:${rel}`]),
    ])
    let merged = ''
    try {
      merged = await fsp.readFile(file, 'utf8')
    } catch {
      /* the file may only exist on one side */
    }
    return {
      base: base.ok ? base.out : '',
      ours: ours.ok ? ours.out : '',
      theirs: theirs.ok ? theirs.out : '',
      merged,
    }
  })

  /** Writes the resolved text and marks the path resolved. */
  ipcMain.handle('git:resolve', async (_e, cwd: string, file: string, content: string) => {
    await fsp.writeFile(file, content, 'utf8')
    return gitSafe(cwd, ['add', '--', path.relative(cwd, file)])
  })

  /* ---------------- shelve ---------------- */

  const shelfDir = (cwd: string) => path.join(cwd, '.nova', 'shelf')

  ipcMain.handle('git:shelfList', async (_e, cwd: string): Promise<ShelfEntry[]> => {
    try {
      const names = await fsp.readdir(shelfDir(cwd))
      const entries = await Promise.all(
        names
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => {
            const raw = await fsp.readFile(path.join(shelfDir(cwd), name), 'utf8')
            return JSON.parse(raw) as ShelfEntry
          }),
      )
      return entries.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  })

  /**
   * Shelve: save a patch of the given files and take them back to HEAD.
   *
   * A patch on disk rather than a stash entry, because a stash is a commit on a
   * hidden ref that a `git stash pop` can only replay in order — a shelf is a
   * file you can apply whenever, in any order, on any branch.
   */
  ipcMain.handle(
    'git:shelve',
    async (_e, cwd: string, name: string, files: string[], revert: boolean) => {
      const relatives = files.map((f) => path.relative(cwd, f))
      if (relatives.length === 0) return { ok: false, out: 'Nothing selected to shelve.' }
      // Untracked files have no diff against HEAD; add them to the index first
      // so `git diff --cached` can see them, then take them back out.
      const untracked: string[] = []
      for (const rel of relatives) {
        const tracked = await gitSafe(cwd, ['ls-files', '--error-unmatch', '--', rel])
        if (!tracked.ok) untracked.push(rel)
      }
      if (untracked.length) await gitSafe(cwd, ['add', '--intent-to-add', '--', ...untracked])

      const diff = await gitSafe(cwd, ['diff', 'HEAD', '--binary', '--', ...relatives])
      if (!diff.ok || !diff.out.trim()) {
        return { ok: false, out: 'Those files have no changes against HEAD.' }
      }

      const id = `shelf_${Date.now().toString(36)}`
      await fsp.mkdir(shelfDir(cwd), { recursive: true })
      await fsp.writeFile(path.join(shelfDir(cwd), `${id}.patch`), diff.out, 'utf8')
      const entry: ShelfEntry = {
        id,
        name: name.trim() || `Shelved ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        createdAt: Date.now(),
        files,
        size: diff.out.length,
      }
      await fsp.writeFile(path.join(shelfDir(cwd), `${id}.json`), JSON.stringify(entry, null, 2))

      if (revert) {
        await gitSafe(cwd, ['restore', '--staged', '--worktree', '--', ...relatives])
        for (const rel of untracked) await gitSafe(cwd, ['clean', '-fd', '--', rel])
      }
      return { ok: true, out: entry.id }
    },
  )

  ipcMain.handle('git:unshelve', async (_e, cwd: string, id: string, drop: boolean) => {
    const patch = path.join(shelfDir(cwd), `${id}.patch`)
    const applied = await gitSafe(cwd, ['apply', '--3way', patch])
    if (!applied.ok) return applied
    if (drop) {
      await fsp.rm(patch, { force: true })
      await fsp.rm(path.join(shelfDir(cwd), `${id}.json`), { force: true })
    }
    return { ok: true, out: 'Unshelved.' }
  })

  ipcMain.handle('git:shelfDrop', async (_e, cwd: string, id: string) => {
    await fsp.rm(path.join(shelfDir(cwd), `${id}.patch`), { force: true })
    await fsp.rm(path.join(shelfDir(cwd), `${id}.json`), { force: true })
    return { ok: true, out: 'Deleted.' }
  })

  ipcMain.handle('git:shelfPatch', async (_e, cwd: string, id: string) => {
    try {
      return await fsp.readFile(path.join(shelfDir(cwd), `${id}.patch`), 'utf8')
    } catch {
      return ''
    }
  })

  /* ---------------- changelists ---------------- */

  const changelistFile = (cwd: string) => path.join(cwd, '.nova', 'changelists.json')

  ipcMain.handle('git:changelists', async (_e, cwd: string): Promise<Changelist[]> => {
    try {
      return JSON.parse(await fsp.readFile(changelistFile(cwd), 'utf8')) as Changelist[]
    } catch {
      return []
    }
  })

  ipcMain.handle('git:saveChangelists', async (_e, cwd: string, lists: Changelist[]) => {
    await fsp.mkdir(path.dirname(changelistFile(cwd)), { recursive: true })
    await fsp.writeFile(changelistFile(cwd), JSON.stringify(lists, null, 2))
  })

  /* ---------------- interactive rebase ---------------- */

  ipcMain.handle(
    'git:rebaseTodo',
    async (_e, cwd: string, onto: string): Promise<RebaseStep[]> => {
      const format = ['%H', '%h', '%s'].join(LOG_FIELD) + LOG_SEP
      const res = await gitSafe(cwd, ['log', `--format=${format}`, `${onto}..HEAD`])
      if (!res.ok) return []
      return res.out
        .split(LOG_SEP)
        .map((chunk) => chunk.replace(/^\n/, ''))
        .filter((chunk) => chunk.trim())
        .map((chunk) => {
          const [hash, shortHash, subject] = chunk.split(LOG_FIELD)
          return { hash, shortHash, subject, action: 'pick' as const }
        })
    },
  )

  /**
   * Runs an interactive rebase without an interactive editor.
   *
   * `GIT_SEQUENCE_EDITOR` is pointed at a `cp` of the todo Nova built, so git
   * gets exactly the plan the user assembled in the UI. Rewording is expressed
   * as `pick` followed by `exec git commit --amend`, which avoids needing a
   * message editor at all — the message is already known.
   */
  ipcMain.handle(
    'git:rebaseRun',
    async (_e, cwd: string, onto: string, steps: RebaseStep[]) => {
      if (steps.length === 0) return { ok: false, out: 'Nothing to rebase.' }
      const lines: string[] = []
      // Git's todo runs oldest-first; the UI shows newest-first, like the log.
      for (const step of [...steps].reverse()) {
        if (step.action === 'drop') {
          lines.push(`drop ${step.hash} ${step.subject}`)
          continue
        }
        if (step.action === 'reword') {
          lines.push(`pick ${step.hash} ${step.subject}`)
          lines.push(`exec git commit --amend -m ${shellQuote(step.message ?? step.subject)}`)
          continue
        }
        lines.push(`${step.action} ${step.hash} ${step.subject}`)
      }

      const todo = path.join(os.tmpdir(), `nova-rebase-${Date.now()}.txt`)
      await fsp.writeFile(todo, `${lines.join('\n')}\n`, 'utf8')
      try {
        const { stdout, stderr } = await exec('git', ['rebase', '-i', '--autostash', onto], {
          cwd,
          maxBuffer: 64 * 1024 * 1024,
          env: {
            ...process.env,
            GIT_OPTIONAL_LOCKS: '0',
            GIT_SEQUENCE_EDITOR: `cp ${JSON.stringify(todo)}`,
            // Squash and fixup would otherwise open an editor for the combined
            // message; taking the default keeps the run non-interactive.
            GIT_EDITOR: 'true',
          },
        })
        return { ok: true, out: `${stdout}${stderr}` }
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message?: string }
        return { ok: false, out: e.stderr || e.stdout || e.message || 'rebase failed' }
      } finally {
        await fsp.rm(todo, { force: true })
      }
    },
  )

  ipcMain.handle('git:rebaseAbort', (_e, cwd: string) => gitSafe(cwd, ['rebase', '--abort']))
  ipcMain.handle('git:rebaseContinue', (_e, cwd: string) => gitSafe(cwd, ['rebase', '--continue']))

  /* ---------------- history for selection ---------------- */

  /**
   * `git log -L` — the history of one *range of lines*, following it through
   * renames and reindentations. IntelliJ calls it History for Selection and it
   * is the fastest way to answer "when did this block become like this".
   */
  ipcMain.handle(
    'git:lineHistory',
    async (_e, cwd: string, file: string, from: number, to: number, limit = 40) => {
      const rel = path.relative(cwd, file) || file
      const res = await gitSafe(cwd, [
        'log',
        `--max-count=${limit}`,
        '--no-color',
        `--format=${LOG_SEP}%H${LOG_FIELD}%h${LOG_FIELD}%s${LOG_FIELD}%an${LOG_FIELD}%at`,
        `-L${from},${to}:${rel}`,
      ])
      if (!res.ok) return { ok: false, out: res.out, entries: [] }
      const entries = res.out
        .split(LOG_SEP)
        .filter((chunk) => chunk.trim())
        .map((chunk) => {
          const newline = chunk.indexOf('\n')
          const header = newline === -1 ? chunk : chunk.slice(0, newline)
          const [hash, shortHash, subject, author, date] = header.split(LOG_FIELD)
          return {
            hash,
            shortHash,
            subject,
            author,
            date: Number(date) || 0,
            diff: newline === -1 ? '' : chunk.slice(newline + 1),
          }
        })
      return { ok: true, out: '', entries }
    },
  )
}
