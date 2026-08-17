/**
 * The three-way merge editor.
 *
 * Layout follows IntelliJ: yours on the left, the result in the middle, theirs
 * on the right. The base version from the index is what conflicts are computed
 * against — hunks where only one side moved are auto-mergeable, and the toolbar
 * offers to take all of those in one click, which is how most conflicts
 * actually get resolved.
 *
 * The middle pane is a live editor. Accepting a hunk splices it into the
 * result; the result can then still be edited by hand before "Apply" writes it
 * back and marks the file resolved with `git add`.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import type * as monacoNs from 'monaco-editor'
import { Check, ChevronDown, ChevronUp, Wand2, X } from 'lucide-react'
import { diffLines, type Change } from 'diff'
import { useStore, type Tab } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import { languageForPath } from '@/lib/language'
import { monaco } from '@/lib/monacoSetup'

type Side = 'ours' | 'theirs'

/**
 * One aligned region across base/ours/theirs.
 * `kind` is which sides changed it relative to the base.
 */
interface Hunk {
  index: number
  baseLines: string[]
  ourLines: string[]
  theirLines: string[]
  kind: 'same' | 'ours' | 'theirs' | 'both-same' | 'conflict'
  resolution: Side | 'base' | 'manual' | null
}

/** Splits three versions into aligned hunks via two 2-way diffs against base. */
function computeHunks(base: string, ours: string, theirs: string): Hunk[] {
  const baseLines = base.split('\n')
  // Anchor both diffs on the base line index, then walk the base together.
  const oursChanges = mapByBaseLine(baseLines, diffLines(base, ours))
  const theirsChanges = mapByBaseLine(baseLines, diffLines(base, theirs))

  const boundaries = new Set<number>([0, baseLines.length])
  for (const map of [oursChanges, theirsChanges]) {
    for (const region of map) {
      boundaries.add(region.baseFrom)
      boundaries.add(region.baseTo)
    }
  }
  const cuts = [...boundaries].sort((a, b) => a - b)

  const hunks: Hunk[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i]
    const to = cuts[i + 1]
    const slice = baseLines.slice(from, to)
    const ourSlice = sliceFor(oursChanges, from, to, slice)
    const theirSlice = sliceFor(theirsChanges, from, to, slice)

    const oursChanged = !sameLines(slice, ourSlice)
    const theirsChanged = !sameLines(slice, theirSlice)
    const kind: Hunk['kind'] = !oursChanged && !theirsChanged
      ? 'same'
      : oursChanged && !theirsChanged
        ? 'ours'
        : !oursChanged && theirsChanged
          ? 'theirs'
          : sameLines(ourSlice, theirSlice)
            ? 'both-same'
            : 'conflict'

    hunks.push({
      index: hunks.length,
      baseLines: slice,
      ourLines: ourSlice,
      theirLines: theirSlice,
      kind,
      resolution: null,
    })
  }
  return mergeAdjacent(hunks)
}

interface BaseRegion {
  baseFrom: number
  baseTo: number
  lines: string[]
}

/** Regions of the *base* that a 2-way diff replaced, keyed by base line. */
function mapByBaseLine(baseLines: string[], changes: Change[]): BaseRegion[] {
  const regions: BaseRegion[] = []
  let baseAt = 0
  let pendingAdd: string[] | null = null
  for (const change of changes) {
    const lines = change.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    if (change.added) {
      pendingAdd = lines
      continue
    }
    if (change.removed) {
      regions.push({ baseFrom: baseAt, baseTo: baseAt + lines.length, lines: pendingAdd ?? [] })
      // An add right before this removal belongs to the same replacement.
      baseAt += lines.length
      pendingAdd = null
      continue
    }
    if (pendingAdd) {
      regions.push({ baseFrom: baseAt, baseTo: baseAt, lines: pendingAdd })
      pendingAdd = null
    }
    baseAt += lines.length
  }
  if (pendingAdd) regions.push({ baseFrom: baseAt, baseTo: baseAt, lines: pendingAdd })

  // A removal followed by an addition arrives as remove-then-add; merge those.
  const merged: BaseRegion[] = []
  for (const region of regions) {
    const last = merged[merged.length - 1]
    if (last && last.baseTo === region.baseFrom && region.baseFrom === region.baseTo && region.lines.length) {
      last.lines = [...last.lines, ...region.lines]
      continue
    }
    if (last && last.baseTo === region.baseTo && last.baseFrom === region.baseFrom) {
      last.lines = [...last.lines, ...region.lines]
      continue
    }
    merged.push({ ...region })
  }
  return merged
}

/** The side's text for base range [from, to), given its replacement regions. */
function sliceFor(regions: BaseRegion[], from: number, to: number, fallback: string[]): string[] {
  const out: string[] = []
  let covered = false
  for (const region of regions) {
    if (region.baseFrom >= to || region.baseTo <= from) {
      if (!(region.baseFrom === region.baseTo && region.baseFrom >= from && region.baseFrom < to)) continue
    }
    covered = true
    out.push(...region.lines)
  }
  return covered ? out : fallback
}

function sameLines(a: string[], b: string[]) {
  return a.length === b.length && a.every((line, i) => line === b[i])
}

/** Collapses runs of unchanged hunks so the list is a set of decisions. */
function mergeAdjacent(hunks: Hunk[]): Hunk[] {
  const out: Hunk[] = []
  for (const hunk of hunks) {
    const last = out[out.length - 1]
    if (last && last.kind === 'same' && hunk.kind === 'same') {
      last.baseLines.push(...hunk.baseLines)
      last.ourLines.push(...hunk.ourLines)
      last.theirLines.push(...hunk.theirLines)
      continue
    }
    out.push({ ...hunk, index: out.length })
  }
  return out.map((hunk, index) => ({ ...hunk, index }))
}

function buildResult(hunks: Hunk[]): string {
  const lines: string[] = []
  for (const hunk of hunks) {
    switch (hunk.kind) {
      case 'same':
        lines.push(...hunk.baseLines)
        break
      case 'ours':
      case 'both-same':
        lines.push(...(hunk.resolution === 'base' ? hunk.baseLines : hunk.ourLines))
        break
      case 'theirs':
        lines.push(...(hunk.resolution === 'base' ? hunk.baseLines : hunk.theirLines))
        break
      case 'conflict':
        if (hunk.resolution === 'ours') lines.push(...hunk.ourLines)
        else if (hunk.resolution === 'theirs') lines.push(...hunk.theirLines)
        else if (hunk.resolution === 'base') lines.push(...hunk.baseLines)
        else {
          lines.push('<<<<<<< yours', ...hunk.ourLines, '=======', ...hunk.theirLines, '>>>>>>> theirs')
        }
        break
    }
  }
  return lines.join('\n')
}

export default function MergeView({ tab }: { tab: Tab }) {
  const root = useStore((s) => s.root) ?? ''
  const file = tab.path!
  const [hunks, setHunks] = useState<Hunk[] | null>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState<string | null>(null)
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.nova.git.mergeStages(root, file).then((stages) => {
      if (cancelled) return
      if (!stages.ours && !stages.theirs) {
        setError('This file has no merge conflict recorded in the index.')
        return
      }
      setHunks(computeHunks(stages.base, stages.ours, stages.theirs))
    })
    return () => {
      cancelled = true
    }
  }, [root, file])

  const conflicts = useMemo(() => (hunks ?? []).filter((h) => h.kind === 'conflict'), [hunks])
  const unresolved = conflicts.filter((h) => h.resolution === null)
  const result = useMemo(() => (hunks ? buildResult(hunks) : ''), [hunks])
  const text = manual ?? result

  const resolve = (index: number, resolution: Hunk['resolution']) => {
    setManual(null)
    setHunks((current) =>
      (current ?? []).map((hunk) => (hunk.index === index ? { ...hunk, resolution } : hunk)),
    )
  }

  const acceptAllNonConflicts = () => {
    // The non-conflict hunks already default to the changed side; this exists
    // for the case where every conflict is one-sided after a mis-merge.
    setManual(null)
    setHunks((current) =>
      (current ?? []).map((hunk) =>
        hunk.kind === 'conflict' && hunk.resolution === null && sameLines(hunk.ourLines, hunk.theirLines)
          ? { ...hunk, resolution: 'ours' }
          : hunk,
      ),
    )
  }

  const apply = async () => {
    const store = useStore.getState()
    if (text.includes('<<<<<<<')) {
      store.notify(`${unresolved.length} conflict(s) still unresolved.`, 'error')
      return
    }
    const res = await window.nova.git.resolve(root, file, text)
    if (!res.ok) {
      store.notify(res.out, 'error')
      return
    }
    store.notify(`Resolved ${basename(file)}`, 'success')
    store.closeTab(tab.id)
    void store.refreshGit()
    void store.reloadBuffer(file).catch(() => undefined)
  }

  if (error) {
    return <div className="empty-state">{error}</div>
  }
  if (!hunks) return <div className="empty-state">Reading merge stages…</div>

  const language = languageForPath(file)
  const settings = useStore.getState().settings

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="usages-header">
        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{relative(root, file)}</span>
        <span className="chip" style={{ color: unresolved.length ? 'var(--danger)' : 'var(--success)' }}>
          {unresolved.length ? `${unresolved.length} of ${conflicts.length} unresolved` : 'all resolved'}
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn sm" title="Resolve conflicts where both sides made the same change" onClick={acceptAllNonConflicts}>
          <Wand2 size={12} /> Auto-resolve trivial
        </button>
        <button className="btn sm" onClick={() => conflicts.forEach((h) => resolve(h.index, 'ours'))}>
          Take all yours
        </button>
        <button className="btn sm" onClick={() => conflicts.forEach((h) => resolve(h.index, 'theirs'))}>
          Take all theirs
        </button>
        <button className="btn primary sm" disabled={unresolved.length > 0} onClick={() => void apply()}>
          <Check size={12} /> Apply and mark resolved
        </button>
      </div>

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Conflict list */}
        <div style={{ width: 320, borderRight: '1px solid var(--border)', overflow: 'auto', flexShrink: 0 }}>
          {conflicts.length === 0 && (
            <div className="faint" style={{ padding: 12, fontSize: 12 }}>
              No conflicting hunks — both sides changed different regions. Review the result and apply.
            </div>
          )}
          {conflicts.map((hunk) => (
            <ConflictCard key={hunk.index} hunk={hunk} onResolve={resolve} />
          ))}
        </div>

        {/* Result editor */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Editor
            path={`merge://${file}`}
            language={language}
            value={text}
            theme={settings.themeId}
            onMount={(editor) => {
              editorRef.current = editor
            }}
            onChange={(value) => setManual(value ?? '')}
            options={{
              fontSize: settings.fontSize,
              minimap: { enabled: false },
              wordWrap: 'off',
              automaticLayout: true,
              renderLineHighlight: 'none',
            }}
          />
        </div>
      </div>
    </div>
  )
}

function ConflictCard({ hunk, onResolve }: { hunk: Hunk; onResolve: (index: number, r: Hunk['resolution']) => void }) {
  const [open, setOpen] = useState(true)
  const state = hunk.resolution

  return (
    <div style={{ borderBottom: '1px solid var(--border)', padding: '8px 10px', display: 'grid', gap: 6 }}>
      <button className="row" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text)' }} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        <b style={{ fontSize: 12 }}>Conflict {hunk.index + 1}</b>
        {state && (
          <span className="chip" style={{ marginLeft: 'auto', color: 'var(--success)' }}>
            {state === 'ours' ? 'yours' : state === 'theirs' ? 'theirs' : state}
          </span>
        )}
        {!state && <span className="chip" style={{ marginLeft: 'auto', color: 'var(--danger)' }}>unresolved</span>}
      </button>

      {open && (
        <>
          <SidePreview label="Yours" lines={hunk.ourLines} active={state === 'ours'} onTake={() => onResolve(hunk.index, 'ours')} />
          <SidePreview label="Theirs" lines={hunk.theirLines} active={state === 'theirs'} onTake={() => onResolve(hunk.index, 'theirs')} />
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => onResolve(hunk.index, 'base')}>
              Take base
            </button>
            {state && (
              <button className="btn sm" onClick={() => onResolve(hunk.index, null)}>
                <X size={11} /> Unresolve
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SidePreview({ label, lines, active, onTake }: { label: string; lines: string[]; active: boolean; onTake: () => void }) {
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      <div className="row">
        <span className="faint" style={{ fontSize: 11 }}>{label}</span>
        <button className={`btn sm ${active ? 'primary' : ''}`} style={{ marginLeft: 'auto' }} onClick={onTake}>
          <Check size={11} /> Take
        </button>
      </div>
      <pre className="mono" style={{ fontSize: 11, background: 'var(--editor-bg, rgba(0,0,0,0.15))', borderRadius: 4, padding: 6, margin: 0, maxHeight: 120, overflow: 'auto' }}>
        {lines.length ? lines.join('\n') : '(removed)'}
      </pre>
    </div>
  )
}
