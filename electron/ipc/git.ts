import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  GitBlameLine,
  GitBranch,
  GitChange,
  GitCommit,
  GitFileStatus,
  GitStashEntry,
  GitStatus,
} from '../../shared/types'

const exec = promisify(execFile)

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
      const format = ['%H', '%h', '%s', '%b', '%an', '%ae', '%at', '%D'].join(LOG_FIELD) + LOG_SEP
      const args = ['log', `--max-count=${limit}`, `--format=${format}`]
      if (branch) args.push(branch)
      const res = await gitSafe(cwd, args)
      if (!res.ok) return []
      return res.out
        .split(LOG_SEP)
        .map((chunk) => chunk.replace(/^\n/, ''))
        .filter((chunk) => chunk.trim().length > 0)
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
    await gitSafe(cwd, create ? ['checkout', '-b', branch] : ['checkout', branch])
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
}
