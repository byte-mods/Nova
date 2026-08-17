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
  GitMerge,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitCommitHorizontal,
  History,
  ListOrdered,
  Minus,
  PackageOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import type { Changelist, GitChange, ShelfEntry } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, dirname, relative, timeAgo } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'
import { languageForPath } from '@/lib/language'
import ContextMenu from '@/components/ContextMenu'
import { openRebaseDialog } from '@/components/RebaseDialog'

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
  const [shelf, setShelf] = useState<ShelfEntry[]>([])
  const [conflicts, setConflicts] = useState<string[]>([])
  const [changelists, setChangelists] = useState<Changelist[]>([])
  const [commitMenu, setCommitMenu] = useState<{ x: number; y: number; hash: string; subject: string } | null>(null)

  const refreshAll = () => {
    void useStore.getState().refreshGit()
    void useStore.getState().refreshCommits()
    if (root) {
      void window.nova.git.stashList(root).then(setStashes)
      void window.nova.git.shelfList(root).then(setShelf)
      void window.nova.git.conflicts(root).then(setConflicts)
      void window.nova.git.changelists(root).then(setChangelists)
    }
  }

  /** Moves a file into a named changelist (creating it) or back to the default. */
  const assignToChangelist = async (file: string, listName: string | null) => {
    if (!root) return
    let next = changelists.map((list) => ({ ...list, files: list.files.filter((f) => f !== file) }))
    if (listName) {
      const existing = next.find((list) => list.name === listName)
      if (existing) existing.files.push(file)
      else {
        next.push({ id: `cl_${Date.now().toString(36)}`, name: listName, files: [file], active: false })
      }
    }
    next = next.filter((list) => list.files.length > 0)
    setChangelists(next)
    await window.nova.git.saveChangelists(root, next)
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
            title="Shelve changes — save a patch and take the files back to HEAD"
            onClick={async () => {
              const changed = (git?.changes ?? []).map((c) => c.path)
              if (changed.length === 0) {
                useStore.getState().notify('Nothing to shelve.', 'error')
                return
              }
              await runGit('shelve', () => window.nova.git.shelve(root, '', [...new Set(changed)], true))
              for (const path of new Set(changed)) {
                void useStore.getState().reloadBuffer(path).catch(() => undefined)
              }
            }}
          >
            <PackageOpen size={14} />
          </button>
          <button
            className="icon-btn"
            title={`Interactive rebase onto ${git?.upstream || 'a base commit'}`}
            onClick={() => {
              const onto = git?.upstream || window.prompt('Rebase onto (branch or commit):', 'origin/main')
              if (onto) openRebaseDialog({ onto })
            }}
          >
            <ListOrdered size={14} />
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
        {conflicts.length > 0 && (
          <>
            <div className="section-header" style={{ color: 'var(--danger)' }}>
              <GitMerge size={12} />
              Merge Conflicts
              <span className="chip" style={{ marginLeft: 'auto', color: 'var(--danger)' }}>{conflicts.length}</span>
            </div>
            {conflicts.map((file) => (
              <div
                key={file}
                className="tree-row"
                style={{ paddingLeft: 14, cursor: 'pointer' }}
                title={`${relative(root, file)} — click to resolve in the merge editor`}
                onClick={() =>
                  useStore.getState().openTab({
                    id: `merge:${file}`,
                    kind: 'merge',
                    title: `${basename(file)} — merge`,
                    subtitle: relative(root, file),
                    path: file,
                  })
                }
              >
                <GitMerge size={13} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                <span className="tree-label">{basename(file)}</span>
                <span className="faint" style={{ fontSize: 10.5 }}>{dirname(relative(root, file))}</span>
              </div>
            ))}
            <div className="row" style={{ padding: '4px 14px', gap: 6 }}>
              <button
                className="btn sm"
                onClick={() => void runGit('rebase --continue', () => window.nova.git.rebaseContinue(root))}
              >
                Continue rebase
              </button>
              <button
                className="btn sm"
                onClick={() => void runGit('rebase --abort', () => window.nova.git.rebaseAbort(root))}
              >
                Abort rebase
              </button>
            </div>
          </>
        )}

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
        {showChanges && (
          <ChangelistGroups
            changes={unstaged}
            changelists={changelists}
            root={root}
            onAssign={assignToChangelist}
          />
        )}
        {showChanges && unstaged.length === 0 && (
          <div className="faint" style={{ padding: '6px 14px', fontSize: 11.5 }}>
            No local changes.
          </div>
        )}

        {shelf.length > 0 && (
          <>
            <div className="section-header">
              <PackageOpen size={12} />
              Shelf
              <span className="chip" style={{ marginLeft: 'auto' }}>{shelf.length}</span>
            </div>
            {shelf.map((entry) => (
              <div key={entry.id} className="tree-row" style={{ paddingLeft: 14 }} title={`${entry.name}\n${entry.files.map((f) => relative(root, f)).join('\n')}`}>
                <span className="tree-label">{entry.name}</span>
                <span className="faint" style={{ fontSize: 10.5 }}>{entry.files.length} file(s)</span>
                <button
                  className="icon-btn"
                  style={{ width: 20, height: 20 }}
                  title="Unshelve (apply and remove from the shelf)"
                  onClick={() => void runGit('unshelve', () => window.nova.git.unshelve(root, entry.id, true))}
                >
                  <Undo2 size={12} />
                </button>
                <button
                  className="icon-btn"
                  style={{ width: 20, height: 20 }}
                  title="Delete without applying"
                  onClick={() => void runGit('delete shelf', () => window.nova.git.shelfDrop(root, entry.id))}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </>
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
        {showHistory && <CommitGraph onContextMenu={setCommitMenu} />}
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

/**
 * IntelliJ-style changelists over the unstaged set.
 *
 * Membership lives in `.nova/changelists.json`, not in git — a changelist is a
 * way of *looking at* local modifications, so files fall out of a list the
 * moment they stop being modified.
 */
function ChangelistGroups({
  changes,
  changelists,
  root,
  onAssign,
}: {
  changes: GitChange[]
  changelists: Changelist[]
  root: string
  onAssign: (file: string, listName: string | null) => Promise<void>
}) {
  const inList = new Map<string, string>()
  for (const list of changelists) {
    for (const file of list.files) inList.set(file, list.name)
  }
  const defaults = changes.filter((change) => !inList.has(change.path))
  const named = changelists
    .map((list) => ({
      list,
      members: changes.filter((change) => list.files.includes(change.path)),
    }))
    .filter((entry) => entry.members.length > 0)

  const rowFor = (change: GitChange) => (
    <ChangeRow
      key={`u:${change.path}`}
      change={change}
      root={root}
      staged={false}
      changelists={changelists.map((l) => l.name)}
      onAssign={onAssign}
    />
  )

  return (
    <>
      {named.length > 0 && defaults.length > 0 && (
        <div className="faint" style={{ padding: '2px 14px', fontSize: 10.5 }}>Default</div>
      )}
      {defaults.map(rowFor)}
      {named.map(({ list, members }) => (
        <div key={list.id}>
          <div className="faint" style={{ padding: '4px 14px 2px', fontSize: 10.5 }}>
            {list.name} · {members.length}
          </div>
          {members.map(rowFor)}
        </div>
      ))}
    </>
  )
}

/* ---------------- log graph ---------------- */

const LANE_COLORS = [
  'var(--accent)',
  '#e5a24d',
  '#5fb96a',
  '#c678dd',
  '#56b6c2',
  '#e06c75',
  '#d19a66',
]

interface GraphRow {
  /** Lane the commit's dot sits in. */
  lane: number
  /** Lanes passing through this row, with the lane they continue into. */
  through: { from: number; to: number }[]
  /** Lanes that merge into this commit (from child rows above). */
  laneCount: number
}

/**
 * Lane assignment for the commit graph, the standard walk: each row claims the
 * lane its first expected child reserved, frees lanes of parents already drawn,
 * and reserves lanes for its own parents.
 */
function computeGraph(commits: { hash: string; parents: string[] }[]): GraphRow[] {
  const rows: GraphRow[] = []
  /** Lane index -> the hash that lane is waiting to reach. */
  let lanes: (string | null)[] = []

  for (const commit of commits) {
    const waiting = lanes.map((hash, lane) => ({ hash, lane })).filter((entry) => entry.hash === commit.hash)
    // The commit's own lane: the leftmost lane waiting for it, or a new one.
    let lane: number
    if (waiting.length > 0) {
      lane = waiting[0].lane
    } else {
      lane = lanes.indexOf(null)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(null)
      }
    }

    const nextLanes = [...lanes]
    // Every lane waiting for this commit collapses into its lane.
    for (const entry of waiting) nextLanes[entry.lane] = null
    // First parent continues in the commit's lane; extra parents branch out.
    const [firstParent, ...restParents] = commit.parents
    nextLanes[lane] = firstParent ?? null
    for (const parent of restParents) {
      if (nextLanes.includes(parent)) continue
      let free = nextLanes.indexOf(null)
      if (free === lane) free = nextLanes.indexOf(null, lane + 1)
      if (free === -1) {
        nextLanes.push(parent)
      } else {
        nextLanes[free] = parent
      }
    }

    const through: { from: number; to: number }[] = []
    for (let i = 0; i < Math.max(lanes.length, nextLanes.length); i++) {
      const hash = lanes[i]
      if (!hash) continue
      if (hash === commit.hash) {
        through.push({ from: i, to: lane })
        continue
      }
      const to = nextLanes.indexOf(hash)
      if (to !== -1) through.push({ from: i, to })
    }
    // Trim trailing empty lanes so the gutter stays narrow.
    while (nextLanes.length && nextLanes[nextLanes.length - 1] === null) nextLanes.pop()

    rows.push({ lane, through, laneCount: Math.max(lanes.length, nextLanes.length, lane + 1) })
    lanes = nextLanes
  }
  return rows
}

const LANE_W = 10
const ROW_H = 34

function CommitGraph({
  onContextMenu,
}: {
  onContextMenu: (menu: { x: number; y: number; hash: string; subject: string }) => void
}) {
  const commits = useStore((s) => s.commits)
  const rows = useMemo(() => computeGraph(commits), [commits])
  const maxLanes = Math.min(8, rows.reduce((max, row) => Math.max(max, row.laneCount), 1))
  const gutter = maxLanes * LANE_W + 6

  return (
    <div>
      {commits.map((commit, index) => {
        const row = rows[index]
        const cx = row.lane * LANE_W + LANE_W / 2
        return (
          <button
            key={commit.hash}
            className="tree-row"
            style={{ width: '100%', paddingLeft: 6, height: ROW_H, position: 'relative' }}
            onClick={() =>
              useStore.getState().openTab({
                id: `commit:${commit.hash}`,
                kind: 'commit',
                title: commit.shortHash,
                subtitle: commit.subject,
                commitHash: commit.hash,
              })
            }
            title={`${commit.subject}\n${commit.author} · ${commit.hash}${commit.refs ? `\n${commit.refs}` : ''}`}
            onContextMenu={(e) => {
              e.preventDefault()
              onContextMenu({ x: e.clientX, y: e.clientY, hash: commit.hash, subject: commit.subject })
            }}
          >
            <svg width={gutter} height={ROW_H} style={{ flexShrink: 0 }}>
              {row.through.map((line, i) => {
                const fromX = line.from * LANE_W + LANE_W / 2
                const toX = line.to * LANE_W + LANE_W / 2
                const isCommitLane = line.to === row.lane && line.from === row.lane
                return (
                  <path
                    key={i}
                    d={
                      line.from === line.to
                        ? `M ${fromX} 0 L ${fromX} ${ROW_H}`
                        : `M ${fromX} 0 C ${fromX} ${ROW_H / 2}, ${toX} ${ROW_H / 2}, ${toX} ${ROW_H}`
                    }
                    stroke={LANE_COLORS[(isCommitLane ? row.lane : line.to) % LANE_COLORS.length]}
                    strokeWidth={1.6}
                    fill="none"
                  />
                )
              })}
              {/* Lines out to this commit's parents start at the dot. */}
              <circle cx={cx} cy={ROW_H / 2} r={3.4} fill={LANE_COLORS[row.lane % LANE_COLORS.length]} />
            </svg>
            <span style={{ display: 'grid', gap: 1, minWidth: 0, textAlign: 'left', flex: 1 }}>
              <span className="tree-label" style={{ color: 'var(--text)' }}>
                {commit.refs && (
                  <span className="chip" style={{ marginRight: 5, fontSize: 9.5 }}>
                    {commit.refs.split(',')[0].replace('HEAD ->', '').trim()}
                  </span>
                )}
                {commit.subject}
              </span>
              <span className="faint" style={{ fontSize: 10.5 }}>
                {commit.author} · {timeAgo(commit.date)} · {commit.shortHash}
              </span>
            </span>
          </button>
        )
      })}
    </div>
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

function ChangeRow({
  change,
  root,
  staged,
  changelists,
  onAssign,
}: {
  change: GitChange
  root: string
  staged: boolean
  changelists?: string[]
  onAssign?: (file: string, listName: string | null) => Promise<void>
}) {
  const iconPack = useStore((s) => s.settings.iconPack)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
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
    <div
      className="tree-row"
      style={{ paddingLeft: 14 }}
      onClick={() => void openDiff()}
      title={rel}
      onContextMenu={(e) => {
        if (!onAssign) return
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {menu && onAssign && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          entries={[
            {
              id: 'new-list',
              label: 'Move to New Changelist…',
              onSelect: () => {
                const name = window.prompt('Changelist name:')
                if (name?.trim()) void onAssign(change.path, name.trim())
              },
            },
            ...(changelists ?? []).map((name) => ({
              id: `list:${name}`,
              label: `Move to “${name}”`,
              onSelect: () => void onAssign(change.path, name),
            })),
            { id: 'sep', separator: true as const },
            {
              id: 'default-list',
              label: 'Move to Default Changelist',
              onSelect: () => void onAssign(change.path, null),
            },
          ]}
        />
      )}
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
