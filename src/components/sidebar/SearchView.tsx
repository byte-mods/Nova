import { useCallback, useEffect, useMemo, useState } from 'react'
import { CaseSensitive, ChevronDown, ChevronRight, Loader2, Regex, Replace, Search } from 'lucide-react'
import type { SearchHit } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'
import { requestApproval } from '@/lib/editPreview'
import { applyWorkspaceEdit } from '@/lib/workspaceEdit'
import { applyMask, buildReplaceEdit } from '@/lib/replaceInPath'

export default function SearchView() {
  const root = useStore((s) => s.root)
  const iconPack = useStore((s) => s.settings.iconPack)
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(false)
  const [fileMask, setFileMask] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [replacing, setReplacing] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  // The palette's "Replace in Project" opens this pane with the field showing.
  useEffect(() => {
    const open = () => setShowReplace(true)
    window.addEventListener('nova:open-replace', open)
    return () => window.removeEventListener('nova:open-replace', open)
  }, [])

  useEffect(() => {
    if (!root || query.trim().length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    setBusy(true)
    const timer = setTimeout(async () => {
      const result = await window.nova.fs.search(root, query, { caseSensitive, regex })
      if (!cancelled) {
        setHits(applyMask(result, fileMask))
        setBusy(false)
      }
    }, 260)
    return () => {
      cancelled = true
      clearTimeout(timer)
      setBusy(false)
    }
  }, [root, query, caseSensitive, regex, fileMask])

  /**
   * Replace across every match, through the same preview a refactoring uses —
   * a project-wide rewrite is exactly the kind of edit you want to see first.
   */
  const replaceAll = useCallback(async () => {
    if (!root || hits.length === 0) return
    setReplacing(true)
    try {
      const edit = await buildReplaceEdit(hits, { query, replacement, caseSensitive, regex })
      const files = Object.keys(edit.changes ?? {}).length
      if (files === 0) {
        useStore.getState().notify('Nothing to replace.', 'info')
        return
      }
      const approved = await requestApproval(
        `Replace “${query}” with “${replacement}” in ${files} file${files === 1 ? '' : 's'}`,
        edit as never,
      )
      if (!approved) return
      const applied = await applyWorkspaceEdit(edit as never)
      const total = applied.reduce((sum, entry) => sum + entry.edits, 0)
      useStore.getState().notify(`Replaced ${total} occurrence${total === 1 ? '' : 's'}`, 'success')
      setHits([])
      void useStore.getState().buildIndex()
    } catch (error) {
      useStore.getState().notify(`Replace failed: ${(error as Error).message}`, 'error')
    } finally {
      setReplacing(false)
    }
  }, [root, hits, query, replacement, caseSensitive, regex])

  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>()
    for (const hit of hits) {
      const list = map.get(hit.path)
      if (list) list.push(hit)
      else map.set(hit.path, [hit])
    }
    return [...map.entries()]
  }, [hits])

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Search</span>
        {busy && <Loader2 size={13} className="spin faint" />}
      </div>
      <div style={{ padding: '4px 10px 10px' }}>
        <div style={{ position: 'relative' }}>
          <Search
            size={13}
            style={{
              position: 'absolute',
              left: 8,
              top: 8,
              color: 'var(--text-faint)',
              pointerEvents: 'none',
            }}
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search across the project"
            style={{ width: '100%', paddingLeft: 26, paddingRight: 54 }}
          />
          <div style={{ position: 'absolute', right: 4, top: 3, display: 'flex' }}>
            <button
              className={`icon-btn ${showReplace ? 'active' : ''}`}
              style={{ width: 22, height: 22 }}
              title="Replace in project"
              onClick={() => setShowReplace((v) => !v)}
            >
              <Replace size={13} />
            </button>
            <button
              className={`icon-btn ${caseSensitive ? 'active' : ''}`}
              style={{ width: 22, height: 22 }}
              title="Match case"
              onClick={() => setCaseSensitive((v) => !v)}
            >
              <CaseSensitive size={13} />
            </button>
            <button
              className={`icon-btn ${regex ? 'active' : ''}`}
              style={{ width: 22, height: 22 }}
              title="Use regular expression"
              onClick={() => setRegex((v) => !v)}
            >
              <Regex size={13} />
            </button>
          </div>
        </div>

        {showReplace && (
          <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder={regex ? 'Replace with… ($1 for groups)' : 'Replace with…'}
              style={{ width: '100%' }}
            />
            <button
              className="btn primary sm"
              disabled={replacing || hits.length === 0}
              onClick={() => void replaceAll()}
            >
              <Replace size={12} /> Replace {hits.length} occurrence{hits.length === 1 ? '' : 's'}…
            </button>
          </div>
        )}

        <input
          value={fileMask}
          onChange={(e) => setFileMask(e.target.value)}
          placeholder="File mask, e.g. *.ts, src/**"
          style={{ width: '100%', marginTop: 6, fontSize: 11.5 }}
        />
        {hits.length > 0 && (
          <div className="faint" style={{ marginTop: 8, fontSize: 11 }}>
            {hits.length} result{hits.length === 1 ? '' : 's'} in {grouped.length} file
            {grouped.length === 1 ? '' : 's'}
          </div>
        )}
      </div>

      <div className="sidebar-scroll">
        {grouped.map(([path, fileHits]) => {
          const { Icon, color } = fileIcon(path, iconPack)
          const isCollapsed = collapsed[path]
          return (
            <div key={path}>
              <button
                className="tree-row"
                style={{ width: '100%', paddingLeft: 6 }}
                onClick={() => setCollapsed((c) => ({ ...c, [path]: !c[path] }))}
              >
                <span className="tree-twisty">
                  {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                </span>
                <Icon size={14} style={{ color, flexShrink: 0 }} />
                <span className="tree-label">{basename(path)}</span>
                <span className="chip" style={{ height: 16 }}>
                  {fileHits.length}
                </span>
              </button>
              {!isCollapsed &&
                fileHits.map((hit, i) => (
                  <button
                    key={`${hit.line}-${i}`}
                    className="tree-row"
                    style={{ width: '100%', paddingLeft: 32 }}
                    title={root ? relative(root, hit.path) : hit.path}
                    onClick={() =>
                      void useStore.getState().openFile(hit.path, { line: hit.line })
                    }
                  >
                    <span className="faint mono" style={{ fontSize: 11, minWidth: 30 }}>
                      {hit.line}
                    </span>
                    <span className="tree-label mono" style={{ fontSize: 11.5 }}>
                      {hit.preview.trim()}
                    </span>
                  </button>
                ))}
            </div>
          )
        })}
        {!busy && query.trim().length >= 2 && hits.length === 0 && (
          <div className="faint" style={{ padding: 14, fontSize: 12 }}>
            No results found.
          </div>
        )}
        <div style={{ height: 30 }} />
      </div>
    </>
  )
}
