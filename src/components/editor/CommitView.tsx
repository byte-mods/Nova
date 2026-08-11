import { useEffect, useMemo, useState } from 'react'
import { Copy, GitCommitHorizontal, User } from 'lucide-react'
import { useStore } from '@/state/store'
import { basename } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'

export default function CommitView({ hash }: { hash: string }) {
  const root = useStore((s) => s.root)!
  const commits = useStore((s) => s.commits)
  const iconPack = useStore((s) => s.settings.iconPack)
  const [files, setFiles] = useState<{ path: string; code: string }[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [diff, setDiff] = useState('')

  const commit = commits.find((c) => c.hash === hash)

  useEffect(() => {
    void window.nova.git.commitFiles(root, hash).then((result) => {
      setFiles(result)
      setSelected(result[0]?.path ?? null)
    })
  }, [root, hash])

  useEffect(() => {
    void window.nova.git.commitDiff(root, hash, selected ?? undefined).then(setDiff)
  }, [root, hash, selected])

  return (
    <div className="commit-view">
      <div className="commit-header">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <GitCommitHorizontal size={17} style={{ color: 'var(--accent)', marginTop: 2 }} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3>{commit?.subject ?? hash.slice(0, 12)}</h3>
            {commit?.body && <pre className="commit-body">{commit.body}</pre>}
            <div className="row faint" style={{ fontSize: 11.5, marginTop: 6, flexWrap: 'wrap' }}>
              <span className="row" style={{ gap: 4 }}>
                <User size={11} /> {commit?.author}
              </span>
              <span>·</span>
              <span>{commit ? new Date(commit.date * 1000).toLocaleString() : ''}</span>
              <span>·</span>
              <button
                className="btn ghost sm mono"
                onClick={() => void navigator.clipboard.writeText(hash)}
                title="Copy full hash"
              >
                <Copy size={11} /> {hash.slice(0, 10)}
              </button>
              {commit?.refs && <span className="chip">{commit.refs}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="commit-body-split">
        <div className="commit-files">
          <button
            className={`tree-row ${selected === null ? 'selected' : ''}`}
            style={{ width: '100%' }}
            onClick={() => setSelected(null)}
          >
            <span className="tree-label">All files ({files.length})</span>
          </button>
          {files.map((file) => {
            const { Icon, color } = fileIcon(file.path, iconPack)
            return (
              <button
                key={file.path}
                className={`tree-row ${selected === file.path ? 'selected' : ''}`}
                style={{ width: '100%' }}
                onClick={() => setSelected(file.path)}
                title={file.path}
              >
                <span className="tree-status" style={{ color: statusColor(file.code) }}>
                  {file.code[0]}
                </span>
                <Icon size={13} style={{ color, flexShrink: 0 }} />
                <span className="tree-label">{basename(file.path)}</span>
              </button>
            )
          })}
        </div>
        <div className="commit-diff">
          <UnifiedDiff text={diff} />
        </div>
      </div>
    </div>
  )
}

function statusColor(code: string) {
  if (code.startsWith('A')) return 'var(--success)'
  if (code.startsWith('D')) return 'var(--danger)'
  if (code.startsWith('R')) return 'var(--info)'
  return 'var(--warning)'
}

export function UnifiedDiff({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text])

  if (!text.trim()) {
    return <div className="faint" style={{ padding: 16 }}>No textual changes.</div>
  }

  return (
    <pre className="unified-diff mono">
      {lines.map((line, i) => {
        let cls = 'ud-ctx'
        if (line.startsWith('+++') || line.startsWith('---')) cls = 'ud-meta'
        else if (line.startsWith('@@')) cls = 'ud-hunk'
        else if (line.startsWith('diff ') || line.startsWith('index ')) cls = 'ud-meta'
        else if (line.startsWith('+')) cls = 'ud-add'
        else if (line.startsWith('-')) cls = 'ud-del'
        return (
          <div key={i} className={cls}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}
