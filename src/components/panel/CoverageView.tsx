/**
 * Coverage summary.
 *
 * Sorted worst-first by default, because the reason to open this panel is to
 * find what is untested — a list sorted by path buries that under whatever
 * happens to start with "a".
 */
import { useMemo, useState } from 'react'
import { Eye, EyeOff, FileCode, Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '@/state/store'
import { percent, type FileCoverage } from '@shared/coverage'
import { relative } from '@/lib/paths'

type SortMode = 'worst' | 'path' | 'size'

export default function CoverageView() {
  const coverage = useStore((s) => s.coverage)
  const loading = useStore((s) => s.coverageLoading)
  const visible = useStore((s) => s.coverageVisible)
  const root = useStore((s) => s.root)
  const [sort, setSort] = useState<SortMode>('worst')

  const files = useMemo(() => {
    const list = [...(coverage?.files ?? [])]
    if (sort === 'worst') {
      list.sort((a, b) => {
        const pa = percent(a.coveredLines, a.totalLines)
        const pb = percent(b.coveredLines, b.totalLines)
        // Ties break on how much code is at stake, so a 0%-covered 500-line
        // file outranks a 0%-covered 3-line one.
        return pa - pb || b.totalLines - a.totalLines
      })
    } else if (sort === 'size') {
      list.sort((a, b) => b.totalLines - a.totalLines)
    } else {
      list.sort((a, b) => a.path.localeCompare(b.path))
    }
    return list
  }, [coverage, sort])

  if (loading) {
    return (
      <div className="empty-state">
        <Loader2 size={16} className="spin faint" />
      </div>
    )
  }

  if (!coverage) {
    return (
      <div className="empty-state" style={{ flexDirection: 'column', gap: 10 }}>
        <span className="faint" style={{ fontSize: 12 }}>
          No coverage report loaded.
        </span>
        <button className="btn sm" onClick={() => void useStore.getState().loadCoverage()}>
          <RefreshCw size={12} /> Look for one
        </button>
        <span className="faint" style={{ fontSize: 10.5, maxWidth: 380, textAlign: 'center', lineHeight: 1.6 }}>
          Run tests with coverage — Nova reads <code className="mono">coverage/lcov.info</code>,
          Istanbul's <code className="mono">coverage-final.json</code>, JaCoCo/Cobertura XML or
          Go's <code className="mono">coverage.out</code>.
        </span>
      </div>
    )
  }

  const { totals } = coverage
  const overall = percent(totals.coveredLines, totals.totalLines)

  return (
    <div className="coverage-view">
      <div className="coverage-head">
        <div className="coverage-overall">
          <Bar value={overall} />
          <strong>{overall}%</strong>
          <span className="faint">
            {totals.coveredLines}/{totals.totalLines} lines
          </span>
          {totals.totalBranches > 0 && (
            <span className="faint">
              {percent(totals.coveredBranches, totals.totalBranches)}% branches
            </span>
          )}
          {totals.totalFunctions > 0 && (
            <span className="faint">
              {percent(totals.coveredFunctions, totals.totalFunctions)}% functions
            </span>
          )}
        </div>

        <div className="row" style={{ gap: 4, marginLeft: 'auto' }}>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            <option value="worst">Least covered</option>
            <option value="size">Largest</option>
            <option value="path">Path</option>
          </select>
          <button
            className={`icon-btn ${visible ? 'active' : ''}`}
            title={visible ? 'Hide gutter markers' : 'Show gutter markers'}
            onClick={() => useStore.getState().toggleCoverageVisible()}
          >
            {visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            className="icon-btn"
            title="Reload the report"
            onClick={() => void useStore.getState().loadCoverage()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="coverage-source faint mono">
        {coverage.format} · {root ? relative(root, coverage.source) : coverage.source}
      </div>

      <div className="coverage-list">
        {files.map((file) => (
          <FileRow key={file.path} file={file} root={root} />
        ))}
      </div>
    </div>
  )
}

function FileRow({ file, root }: { file: FileCoverage; root: string | null }) {
  const value = percent(file.coveredLines, file.totalLines)
  const missed = file.totalLines - file.coveredLines

  return (
    <button
      className="coverage-row"
      title={`${file.uncovered.length} uncovered line(s)`}
      onClick={() => {
        // Jump straight to the first gap; that is what the row is for.
        void useStore.getState().openFile(file.path, { line: file.uncovered[0] })
      }}
    >
      <FileCode size={12} className="faint" />
      <span className="coverage-path">{root ? relative(root, file.path) : file.path}</span>
      <Bar value={value} />
      <span className={`coverage-pct ${tone(value)}`}>{value}%</span>
      <span className="faint coverage-missed">{missed > 0 ? `${missed} missed` : ''}</span>
    </button>
  )
}

function Bar({ value }: { value: number }) {
  return (
    <span className="coverage-bar" aria-hidden>
      <span className={`coverage-bar-fill ${tone(value)}`} style={{ width: `${value}%` }} />
    </span>
  )
}

function tone(value: number): string {
  if (value >= 80) return 'ok'
  if (value >= 50) return 'warn'
  return 'bad'
}
