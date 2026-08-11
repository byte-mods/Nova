import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CloudDownload,
  Copy,
  Undo2,
  GitFork,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  History,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import type { GitChange } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, dirname, relative, timeAgo } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'
import { languageForPath } from '@/lib/language'
import ContextMenu from '@/components/ContextMenu'

export default function GitView() {
  const root = useStore((s) => s.root)
  const git = useStore((s) => s.git)
  const commits = useStore((s) => s.commits)
  const [message, setMessage] = useState('')
  const [showStaged, setShowStaged] = useState(true)
  const [showChanges, setShowChanges] = useState(true)
  const [showHistory, setShowHistory] = useState(true)
  const [committing, setCommitting] = useState(false)
  const [stashes, setStashes] = useState<{ ref: string; subject: string; date: number }[]>([])
  const [commitMenu, setCommitMenu] = useState<{ x: number; y: number; hash: string; subject: string } | null>(null)

  const refreshAll = () => {
    void useStore.getState().refreshGit()
    void useStore.getState().refreshCommits()
    if (root) void window.nova.git.stashList(root).then(setStashes)
  }

  /** Runs a git command and reports the result, refreshing everything after. */
  const runGit = async (label: string, action: () => Promise<{ ok: boolean; out: string }>) => {
    const result = await action()
    const message = result.out.trim().split('\n').filter(Boolean).pop() ?? ''
    useStore.getState().notify(
      result.ok ? `${label}: ${message || 'done'}` : `${label} failed — ${message}`,
      result.ok ? 'success' : 'error',
    )
    refreshAll()
    useStore.getState().bumpTree()
  }

  useEffect(refreshAll, [root])

  const staged = useMemo(() => (git?.changes ?? []).filter((c) => c.staged), [git])
  const unstaged = useMemo(() => (git?.changes ?? []).filter((c) => !c.staged), [git])

  if (!root) {
    return (
      <>
        <div className="sidebar-header">
          <span className="sidebar-title">Source Control</span>
        </div>
        <div className="faint" style={{ padding: 14 }}>
          Open a folder to use source control.
        </div>
      </>
    )
  }

  if (git && !git.isRepo) {
    return (
      <>
        <div className="sidebar-header">
          <span className="sidebar-title">Source Control</span>
        </div>
        <div style={{ padding: 14, display: 'grid', gap: 10 }}>
          <span className="faint">This folder is not a Git repository.</span>
          <button
            className="btn primary"
            onClick={async () => {
              await window.nova.git.init(root)
              await useStore.getState().refreshGit()
              useStore.getState().notify('Initialised an empty Git repository', 'success')
            }}
          >
            Initialise Repository
          </button>
        </div>
      </>
    )
  }

  const doCommit = async () => {
    if (!message.trim()) return
    setCommitting(true)
    try {
      if (staged.length === 0 && unstaged.length > 0) {
        await window.nova.git.stage(root, unstaged.map((c) => c.path))
      }
      const out = await window.nova.git.commit(root, message)
      setMessage('')
      await useStore.getState().refreshGit()
      await useStore.getState().refreshCommits()
      useStore.getState().notify(out.split('\n')[0] || 'Committed', 'success')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Source Control</span>
        <div className="row" style={{ gap: 0 }}>
          <button
            className="icon-btn"
            title="Fetch all remotes"
            onClick={() => void runGit('fetch', () => window.nova.git.fetch(root))}
          >
            <CloudDownload size={14} />
          </button>
          <button
            className="icon-btn"
            title="Pull (fast-forward only)"
            onClick={() => void runGit('pull', () => window.nova.git.pull(root))}
          >
            <ArrowDownToLine size={14} />
          </button>
          <button
            className="icon-btn"
            title={git?.upstream ? 'Push' : 'Push and set upstream'}
            onClick={() => void runGit('push', () => window.nova.git.push(root, !git?.upstream))}
          >
            <ArrowUpFromLine size={14} />
          </button>
          <button
            className="icon-btn"
            title="Stash all changes"
            onClick={() => void runGit('stash', () => window.nova.git.stash(root, ''))}
          >
            <Archive size={14} />
          </button>
          <button
            className="icon-btn"
            title="Refresh"
            onClick={() => {
              void useStore.getState().refreshGit()
              void useStore.getState().refreshCommits()
            }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div style={{ padding: '2px 10px 10px', display: 'grid', gap: 8 }}>
        <BranchPicker />
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`Message (⌘↵ to commit on ${git?.branch ?? 'HEAD'})`}
          rows={3}
          style={{ resize: 'vertical', fontSize: 12.5 }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void doCommit()
          }}
        />
        <button
          className="btn primary"
          disabled={!message.trim() || committing || (staged.length === 0 && unstaged.length === 0)}
          onClick={() => void doCommit()}
        >
          <Check size={13} />
          Commit{staged.length === 0 && unstaged.length > 0 ? ' All' : ''}
        </button>
      </div>

      <div className="sidebar-scroll">
        {staged.length > 0 && (
          <>
            <button className="section-header" onClick={() => setShowStaged((v) => !v)}>
              {showStaged ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Staged Changes
              <span className="chip" style={{ marginLeft: 'auto' }}>{staged.length}</span>
            </button>
            {showStaged &&
              staged.map((change) => (
                <ChangeRow key={`s:${change.path}`} change={change} root={root} staged />
              ))}
          </>
        )}

        <button className="section-header" onClick={() => setShowChanges((v) => !v)}>
          {showChanges ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Changes
          <span className="chip" style={{ marginLeft: 'auto' }}>{unstaged.length}</span>
        </button>
        {showChanges &&
          unstaged.map((change) => (
            <ChangeRow key={`u:${change.path}`} change={change} root={root} staged={false} />
          ))}
        {showChanges && unstaged.length === 0 && (
          <div className="faint" style={{ padding: '6px 14px', fontSize: 11.5 }}>
            No local changes.
          </div>
        )}

        {stashes.length > 0 && (
          <>
            <div className="section-header">
              <Archive size={12} />
              Stashes
              <span className="chip" style={{ marginLeft: 'auto' }}>{stashes.length}</span>
            </div>
            {stashes.map((stash) => (
              <div key={stash.ref} className="tree-row" style={{ paddingLeft: 14 }} title={stash.subject}>
                <span className="tree-label">{stash.subject}</span>
                <button
                  className="icon-btn"
                  style={{ width: 20, height: 20 }}
                  title="Pop (apply and drop)"
                  onClick={() =>
                    void runGit('stash pop', () => window.nova.git.stashApply(root, stash.ref, true))
                  }
                >
                  <Undo2 size={12} />
                </button>
                <button
                  className="icon-btn"
                  style={{ width: 20, height: 20 }}
                  title="Drop"
                  onClick={() =>
                    void runGit('stash drop', () => window.nova.git.stashDrop(root, stash.ref))
                  }
                >
                  <Minus size={12} />
                </button>
              </div>
            ))}
          </>
        )}

        <button className="section-header" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <History size={12} />
          Commits
          <span className="chip" style={{ marginLeft: 'auto' }}>{commits.length}</span>
        </button>
        {showHistory &&
          commits.map((commit) => (
            <button
              key={commit.hash}
              className="tree-row"
              style={{ width: '100%', paddingLeft: 12, height: 'auto', paddingTop: 5, paddingBottom: 5 }}
              onClick={() =>
                useStore.getState().openTab({
                  id: `commit:${commit.hash}`,
                  kind: 'commit',
                  title: commit.shortHash,
                  subtitle: commit.subject,
                  commitHash: commit.hash,
                })
              }
              title={`${commit.subject}\n${commit.author} · ${commit.hash}`}
              onContextMenu={(e) => {
                e.preventDefault()
                setCommitMenu({ x: e.clientX, y: e.clientY, hash: commit.hash, subject: commit.subject })
              }}
            >
              <GitCommitHorizontal size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span style={{ display: 'grid', gap: 1, minWidth: 0, textAlign: 'left' }}>
                <span className="tree-label" style={{ color: 'var(--text)' }}>
                  {commit.subject}
                </span>
                <span className="faint" style={{ fontSize: 10.5 }}>
                  {commit.author} · {timeAgo(commit.date)} · {commit.shortHash}
                </span>
              </span>
            </button>
          ))}
        <div style={{ height: 30 }} />
      </div>

      {commitMenu && (
        <ContextMenu
          x={commitMenu.x}
          y={commitMenu.y}
          onClose={() => setCommitMenu(null)}
          entries={[
            {
              id: 'copy',
              label: 'Copy Commit Hash',
              Icon: Copy,
              onSelect: () => void navigator.clipboard.writeText(commitMenu.hash),
            },
            {
              id: 'revert',
              label: 'Revert This Commit',
              Icon: Undo2,
              onSelect: () =>
                void runGit('revert', () => window.nova.git.revert(root, commitMenu.hash)),
            },
            {
              id: 'cherry',
              label: 'Cherry-pick Onto Current Branch',
              Icon: GitFork,
              onSelect: () =>
                void runGit('cherry-pick', () => window.nova.git.cherryPick(root, commitMenu.hash)),
            },
            { id: 'sep', separator: true },
            {
              id: 'reset-soft',
              label: 'Reset to Here (keep changes)',
              Icon: RotateCcw,
              onSelect: () =>
                void runGit('reset', () => window.nova.git.resetTo(root, commitMenu.hash, 'mixed')),
            },
            {
              id: 'reset-hard',
              label: 'Reset to Here (discard changes)',
              Icon: RotateCcw,
              danger: true,
              onSelect: () =>
                void runGit('reset --hard', () =>
                  window.nova.git.resetTo(root, commitMenu.hash, 'hard'),
                ),
            },
          ]}
        />
      )}
    </>
  )
}

function BranchPicker() {
  const root = useStore((s) => s.root)!
  const git = useStore((s) => s.git)
  const [branches, setBranches] = useState<string[]>([])

  useEffect(() => {
    void window.nova.git.branches(root).then((list) => setBranches(list.filter((b) => !b.remote).map((b) => b.name)))
  }, [root, git?.branch])

  return (
    <div className="row">
      <GitBranch size={13} className="faint" />
      <select
        className="select"
        style={{ flex: 1 }}
        value={git?.branch ?? ''}
        onChange={async (e) => {
          await window.nova.git.checkout(root, e.target.value)
          await useStore.getState().refreshGit()
          await useStore.getState().refreshCommits()
          useStore.getState().bumpTree()
        }}
      >
        {git?.branch && !branches.includes(git.branch) && (
          <option value={git.branch}>{git.branch}</option>
        )}
        {branches.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
      {git && (git.ahead > 0 || git.behind > 0) && (
        <span className="chip">
          ↑{git.ahead} ↓{git.behind}
        </span>
      )}
    </div>
  )
}

const STATUS_COLOR: Record<string, string> = {
  modified: 'var(--warning)',
  added: 'var(--success)',
  untracked: 'var(--success)',
  deleted: 'var(--danger)',
  conflicted: 'var(--danger)',
  renamed: 'var(--info)',
  unknown: 'var(--text-muted)',
}

const STATUS_LETTER: Record<string, string> = {
  modified: 'M',
  added: 'A',
  untracked: 'U',
  deleted: 'D',
  conflicted: '!',
  renamed: 'R',
  unknown: '?',
}

function ChangeRow({ change, root, staged }: { change: GitChange; root: string; staged: boolean }) {
  const iconPack = useStore((s) => s.settings.iconPack)
  const { Icon, color } = fileIcon(change.path, iconPack)
  const rel = relative(root, change.path)

  const openDiff = async () => {
    const store = useStore.getState()
    const after =
      change.status === 'deleted' ? '' : (await window.nova.fs.read(change.path).catch(() => null))?.content ?? ''
    const before =
      change.status === 'untracked' || change.status === 'added'
        ? ''
        : await window.nova.git.showFile(root, staged ? 'HEAD' : 'HEAD', change.path)
    store.openTab({
      id: `diff:${staged ? 'staged' : 'work'}:${change.path}`,
      kind: 'diff',
      title: `${basename(change.path)} (diff)`,
      subtitle: rel,
      path: change.path,
      diff: {
        before,
        after,
        language: languageForPath(change.path),
        targetPath: staged ? undefined : change.path,
      },
    })
  }

  return (
    <div className="tree-row" style={{ paddingLeft: 14 }} onClick={() => void openDiff()} title={rel}>
      <Icon size={14} style={{ color, flexShrink: 0 }} />
      <span className="tree-label">{basename(change.path)}</span>
      <span className="faint" style={{ fontSize: 10.5, maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {dirname(rel) === '/' ? '' : dirname(rel)}
      </span>
      <div className="row" style={{ gap: 0 }} onClick={(e) => e.stopPropagation()}>
        {!staged && change.status !== 'untracked' && (
          <button
            className="icon-btn"
            style={{ width: 20, height: 20 }}
            title="Discard changes"
            onClick={async () => {
              await window.nova.git.discard(root, [change.path])
              await useStore.getState().refreshGit()
              await useStore.getState().reloadBuffer(change.path)
              useStore.getState().bumpTree()
            }}
          >
            <RotateCcw size={12} />
          </button>
        )}
        <button
          className="icon-btn"
          style={{ width: 20, height: 20 }}
          title={staged ? 'Unstage' : 'Stage'}
          onClick={async () => {
            if (staged) await window.nova.git.unstage(root, [change.path])
            else await window.nova.git.stage(root, [change.path])
            await useStore.getState().refreshGit()
          }}
        >
          {staged ? <Minus size={12} /> : <Plus size={12} />}
        </button>
      </div>
      <span className="tree-status" style={{ color: STATUS_COLOR[change.status] }}>
        {STATUS_LETTER[change.status]}
      </span>
    </div>
  )
}
