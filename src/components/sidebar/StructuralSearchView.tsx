/**
 * Structural search and replace.
 *
 * Separate from the text Search pane rather than a mode inside it, because the
 * inputs are genuinely different: a pattern with `$holes$`, a preview of what
 * each hole captured, and a replacement that refers to those holes by name.
 * Folding that into the text search would make the common case worse.
 */
import { useCallback, useState } from 'react'
import { Braces, ChevronDown, ChevronRight, Loader2, Replace } from 'lucide-react'
import { useStore } from '@/state/store'
import { relative } from '@/lib/paths'
import { requestApproval } from '@/lib/editPreview'
import type { StructuralHit } from '@shared/types'

const EXAMPLES = [
  { pattern: 'console.log($arg$)', replacement: 'logger.debug($arg$)', label: 'Swap a logger' },
  { pattern: '$x$ === $x$', replacement: '', label: 'Find self-comparisons' },
  { pattern: 'new Promise($body$)', replacement: '', label: 'Find raw Promise construction' },
]

export default function StructuralSearchView() {
  const root = useStore((s) => s.root)
  const [pattern, setPattern] = useState('')
  const [replacement, setReplacement] = useState('')
  const [include, setInclude] = useState('')
  const [hits, setHits] = useState<StructuralHit[]>([])
  const [busy, setBusy] = useState(false)
  const [searched, setSearched] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  const search = useCallback(async () => {
    if (!root || !pattern.trim()) return
    setBusy(true)
    try {
      setHits(await window.nova.structural.search(root, pattern, { include: include || undefined }))
      setSearched(true)
    } catch (err) {
      useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }, [root, pattern, include])

  /**
   * Replacement goes through the same preview a refactoring uses. A structural
   * rewrite touches code the user has not read, so applying it unseen would be
   * the wrong default no matter how confident the pattern looks.
   */
  const replaceAll = useCallback(async () => {
    if (!hits.length) return
    const files = Array.from(new Set(hits.map((h) => h.path)))
    setBusy(true)
    try {
      const changes = await window.nova.structural.replace(files, pattern, replacement)
      if (!changes.length) {
        useStore.getState().notify('Nothing to replace.', 'info')
        return
      }
      const edit = {
        changes: Object.fromEntries(
          changes.map((c) => [
            c.path,
            [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: c.before.split('\n').length, character: 0 },
                },
                newText: c.after,
              },
            ],
          ]),
        ),
      }
      const approved = await requestApproval(
        `Replace “${pattern}” with “${replacement}” in ${changes.length} file${changes.length === 1 ? '' : 's'}`,
        edit as never,
      )
      if (!approved) return

      for (const change of changes) await window.nova.fs.write(change.path, change.after)
      useStore.getState().notify(`Rewrote ${changes.length} file(s)`, 'success')
      setHits([])
      void useStore.getState().buildIndex()
    } catch (err) {
      useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBusy(false)
    }
  }, [hits, pattern, replacement])

  const grouped = new Map<string, StructuralHit[]>()
  for (const hit of hits) {
    const list = grouped.get(hit.path) ?? []
    list.push(hit)
    grouped.set(hit.path, list)
  }

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Structural Search</span>
        {busy && <Loader2 size={13} className="spin faint" />}
      </div>

      <div style={{ padding: '4px 10px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <textarea
          className="struct-input mono"
          placeholder="Pattern, e.g. console.log($arg$)"
          value={pattern}
          spellCheck={false}
          rows={2}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void search()
          }}
        />
        <textarea
          className="struct-input mono"
          placeholder="Replacement (optional), e.g. logger.debug($arg$)"
          value={replacement}
          spellCheck={false}
          rows={2}
          onChange={(e) => setReplacement(e.target.value)}
        />
        <input
          placeholder="File mask, e.g. *.ts, src/**"
          value={include}
          spellCheck={false}
          onChange={(e) => setInclude(e.target.value)}
        />

        <div className="row" style={{ gap: 5 }}>
          <button className="btn primary sm" disabled={!pattern.trim() || busy} onClick={() => void search()}>
            <Braces size={12} /> Search
          </button>
          <button
            className="btn sm"
            disabled={!hits.length || !replacement.trim() || busy}
            onClick={() => void replaceAll()}
          >
            <Replace size={12} /> Replace all
          </button>
        </div>

        {!searched && (
          <div className="struct-examples">
            <span className="faint" style={{ fontSize: 10 }}>
              Holes are named <code className="mono">$like$</code> and capture balanced code, so a
              nested call is captured whole. The same hole twice must match the same text.
            </span>
            {EXAMPLES.map((example) => (
              <button
                key={example.pattern}
                className="struct-example"
                onClick={() => {
                  setPattern(example.pattern)
                  setReplacement(example.replacement)
                }}
              >
                <b>{example.label}</b>
                <code className="mono">{example.pattern}</code>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="sidebar-scroll">
        {searched && !hits.length && !busy && (
          <p className="faint" style={{ padding: 12, fontSize: 11.5 }}>
            No structural matches.
          </p>
        )}
        {Array.from(grouped.entries()).map(([file, fileHits]) => (
          <div key={file}>
            <button
              className="search-file"
              onClick={() => setCollapsed((c) => ({ ...c, [file]: !c[file] }))}
            >
              {collapsed[file] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="search-file-name">{root ? relative(root, file) : file}</span>
              <span className="chip">{fileHits.length}</span>
            </button>
            {!collapsed[file] &&
              fileHits.map((hit, i) => (
                <button
                  key={`${hit.line}:${hit.column}:${i}`}
                  className="struct-hit"
                  onClick={() => void useStore.getState().openFile(hit.path, { line: hit.line, column: hit.column })}
                >
                  <span className="struct-line">{hit.line}</span>
                  <span className="struct-text mono">{hit.text.replace(/\s+/g, ' ').slice(0, 120)}</span>
                  {Object.keys(hit.captures).length > 0 && (
                    <span className="struct-captures mono">
                      {Object.entries(hit.captures)
                        .map(([name, value]) => `$${name}$ = ${value.replace(/\s+/g, ' ').slice(0, 40)}`)
                        .join('   ')}
                    </span>
                  )}
                </button>
              ))}
          </div>
        ))}
      </div>
    </>
  )
}
