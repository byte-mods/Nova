/**
 * The profiler: a flame graph over the call tree, and a hot-function table.
 *
 * The flame graph is plain nested divs rather than a canvas. A profile of a
 * real program is a few thousand frames after the width filter below, which the
 * DOM handles fine, and it means text selection, hover titles and theme colours
 * all work without reimplementing them.
 */
import { useMemo, useState } from 'react'
import { Flame, FolderOpen, Loader2, Play } from 'lucide-react'
import { useStore } from '@/state/store'
import type { CpuProfile, ProfileFrame } from '@shared/profile'
import { relative } from '@/lib/paths'

export default function ProfileView() {
  const root = useStore((s) => s.root)
  const [profile, setProfile] = useState<CpuProfile | null>(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'flame' | 'table'>('flame')
  const [script, setScript] = useState('')
  const [focus, setFocus] = useState<ProfileFrame | null>(null)

  const open = async () => {
    const picked = await window.nova.app.openFileDialog({
      filters: [{ name: 'CPU profile', extensions: ['cpuprofile'] }],
    })
    if (!picked) return
    setBusy(true)
    try {
      setProfile(await window.nova.profile.open(picked))
      setFocus(null)
    } catch (err) {
      useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (!root || !script.trim()) return
    setBusy(true)
    try {
      setProfile(await window.nova.profile.run(root, script.trim()))
      setFocus(null)
    } catch (err) {
      useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const displayRoot = focus ?? profile?.root ?? null

  return (
    <div className="profile-view">
      <div className="profile-head">
        <input
          placeholder="Script to profile, e.g. dist/server.js"
          value={script}
          spellCheck={false}
          onChange={(e) => setScript(e.target.value)}
          style={{ height: 22, width: 240 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
          }}
        />
        <button className="btn sm" disabled={!script.trim() || busy} onClick={() => void run()}>
          {busy ? <Loader2 size={11} className="spin" /> : <Play size={11} />} Profile
        </button>
        <button className="btn sm" disabled={busy} onClick={() => void open()}>
          <FolderOpen size={11} /> Open .cpuprofile
        </button>

        {profile && (
          <>
            <div className="segmented" style={{ marginLeft: 8 }}>
              <button className={mode === 'flame' ? 'active' : ''} onClick={() => setMode('flame')}>
                Flame
              </button>
              <button className={mode === 'table' ? 'active' : ''} onClick={() => setMode('table')}>
                Hot functions
              </button>
            </div>
            <span className="faint" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
              {profile.durationMs.toFixed(0)} ms · {profile.sampleCount} samples
            </span>
            {focus && (
              <button className="link-btn" title="Show the whole profile again" onClick={() => setFocus(null)}>
                Reset zoom
              </button>
            )}
          </>
        )}
      </div>

      {!profile && !busy && (
        <div className="empty-state" style={{ flexDirection: 'column', gap: 8 }}>
          <Flame size={18} className="faint" />
          <span className="faint" style={{ fontSize: 12 }}>
            No profile loaded.
          </span>
          <span className="faint" style={{ fontSize: 10.5, maxWidth: 420, textAlign: 'center', lineHeight: 1.6 }}>
            Profile a Node script above, or open a <code className="mono">.cpuprofile</code> exported
            from Chrome DevTools or written by <code className="mono">node --cpu-prof</code>.
          </span>
        </div>
      )}

      {busy && !profile && (
        <div className="empty-state">
          <Loader2 size={16} className="spin faint" />
        </div>
      )}

      {profile && displayRoot && mode === 'flame' && (
        <div className="flame-wrap">
          <FlameRow frame={displayRoot} total={displayRoot.totalTime} depth={0} onZoom={setFocus} />
        </div>
      )}

      {profile && mode === 'table' && <HotTable profile={profile} root={root} />}
    </div>
  )
}

/**
 * One frame and its children.
 *
 * Frames narrower than a pixel are dropped rather than rendered at zero width:
 * they cannot be read or clicked, and in a deep profile they are the bulk of
 * the nodes.
 */
function FlameRow({
  frame,
  total,
  depth,
  onZoom,
}: {
  frame: ProfileFrame
  total: number
  depth: number
  onZoom: (frame: ProfileFrame) => void
}) {
  const width = total > 0 ? (frame.totalTime / total) * 100 : 0
  if (width < 0.12 || depth > 60) return null

  const label = `${frame.functionName} — ${frame.totalTime.toFixed(1)} ms (self ${frame.selfTime.toFixed(1)} ms)${
    frame.url ? `\n${frame.url}:${frame.lineNumber}` : ''
  }`

  return (
    <div className="flame-node" style={{ width: `${width}%` }}>
      <button
        className="flame-bar"
        style={{ background: colourFor(frame.functionName) }}
        title={label}
        onClick={() => onZoom(frame)}
      >
        <span>{frame.functionName}</span>
      </button>
      <div className="flame-children">
        {frame.children
          .slice()
          .sort((a, b) => b.totalTime - a.totalTime)
          .map((child) => (
            <FlameRow key={child.id} frame={child} total={total} depth={depth + 1} onZoom={onZoom} />
          ))}
      </div>
    </div>
  )
}

function HotTable({ profile, root }: { profile: CpuProfile; root: string | null }) {
  const rows = useMemo(() => profile.hot.slice(0, 200), [profile])

  return (
    <div className="profile-table-wrap">
      <table className="profile-table">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Self</th>
            <th style={{ width: 70 }}>Total</th>
            <th>Function</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={`${row.functionName}:${row.url}:${row.lineNumber}:${i}`}
              onDoubleClick={() => {
                const file = fileFromUrl(row.url)
                if (file) void useStore.getState().openFile(file, { line: row.lineNumber })
              }}
            >
              <td className="profile-num">
                <span className="profile-bar" style={{ width: `${Math.min(row.selfPercent, 100)}%` }} />
                {row.selfTime.toFixed(1)} ms
              </td>
              <td className="profile-num faint">{row.totalTime.toFixed(1)} ms</td>
              <td className="mono">{row.functionName}</td>
              <td className="mono faint profile-loc">
                {row.url ? `${root ? relative(root, fileFromUrl(row.url) ?? row.url) : row.url}:${row.lineNumber}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fileFromUrl(url: string): string | null {
  if (!url) return null
  if (url.startsWith('file://')) return decodeURIComponent(url.slice(7))
  if (url.startsWith('/')) return url
  return null
}

/**
 * Stable pseudo-random hue per function name.
 *
 * Flame graphs are conventionally coloured arbitrarily — the colour carries no
 * meaning, it just makes adjacent frames distinguishable. Deriving it from the
 * name keeps a function the same colour between runs, which helps when
 * comparing two profiles.
 */
function colourFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 40
  return `hsl(${20 + hue}, 72%, ${52 + (Math.abs(hash >> 8) % 12)}%)`
}
