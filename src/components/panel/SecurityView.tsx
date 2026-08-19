/**
 * The security panel.
 *
 * Findings are grouped by severity and each one carries what to do about it,
 * because a list of problems with no fixes attached is a list people learn to
 * scroll past. Confidence is shown next to severity for the same reason: a
 * pattern scanner cannot prove a vulnerability, and pretending otherwise is
 * how a tool loses the benefit of the doubt on the findings that are real.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bug,
  KeyRound,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useStore } from '@/state/store'
import type {
  Confidence,
  ScanProgress,
  ScanResult,
  SecurityFinding,
  Severity,
} from '@shared/security'

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

const SOURCE_ICON = {
  sast: Bug,
  secret: KeyRound,
  dependency: Package,
} as const

export default function SecurityView() {
  const root = useStore((s) => s.root)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [scanning, setScanning] = useState(false)
  const [phases, setPhases] = useState({ sast: true, secrets: true, dependencies: true })
  const [minimum, setMinimum] = useState<Severity>('low')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => window.nova.security.onProgress(setProgress), [])

  const scan = useCallback(async () => {
    if (!root) {
      useStore.getState().notify('Open a project first.', 'info')
      return
    }
    setScanning(true)
    setResult(null)
    try {
      setResult(await window.nova.security.scan(root, phases))
    } catch (err) {
      useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setScanning(false)
      setProgress(null)
    }
  }, [root, phases])

  const shown = useMemo(() => {
    if (!result) return []
    const floor = SEVERITIES.indexOf(minimum)
    return result.findings.filter((f) => SEVERITIES.indexOf(f.severity) <= floor)
  }, [result, minimum])

  const counts = useMemo(() => {
    const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
    for (const finding of result?.findings ?? []) out[finding.severity]++
    return out
  }, [result])

  return (
    <div className="security-view">
      <div className="panel-toolbar">
        <button className="btn sm" onClick={() => void scan()} disabled={scanning} title="Scan this project for vulnerabilities, committed secrets and known-vulnerable dependencies">
          {scanning ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
          {scanning ? 'Scanning…' : 'Scan project'}
        </button>

        {(['sast', 'secrets', 'dependencies'] as const).map((phase) => (
          <label key={phase} className="security-check" title={PHASE_HINT[phase]}>
            <input
              type="checkbox"
              checked={phases[phase]}
              onChange={(e) => setPhases((current) => ({ ...current, [phase]: e.target.checked }))}
            />
            {PHASE_LABEL[phase]}
          </label>
        ))}

        <label className="security-check" title="Hide findings below this severity">
          Show
          <select value={minimum} onChange={(e) => setMinimum(e.target.value as Severity)}>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severity} and above
              </option>
            ))}
          </select>
        </label>

        <span style={{ flex: 1 }} />

        {result && (
          <span className="faint" style={{ fontSize: 10.5 }}>
            {result.filesScanned} files · {(result.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {scanning && progress && progress.phase !== 'done' && (
        <div className="security-progress">
          <Loader2 size={11} className="spin" />
          <span className="faint">
            {PHASE_LABEL[progress.phase === 'sast' ? 'sast' : progress.phase === 'secrets' ? 'secrets' : 'dependencies']}
            {progress.total > 0 && ` — ${progress.scanned}/${progress.total}`}
          </span>
          <span className="faint mono security-progress-file">{progress.message}</span>
        </div>
      )}

      {result && (
        <div className="security-summary">
          {SEVERITIES.filter((s) => counts[s] > 0).map((severity) => (
            <span key={severity} className={`security-pill sev-${severity}`}>
              {counts[severity]} {severity}
            </span>
          ))}
          {!result.findings.length && (
            <span className="security-clean">
              <ShieldCheck size={13} /> Nothing found
            </span>
          )}
          {result.notes.map((note) => (
            <span key={note} className="faint" style={{ fontSize: 10.5 }}>
              <AlertTriangle size={10} /> {note}
            </span>
          ))}
        </div>
      )}

      <div className="security-list">
        {!result && !scanning && (
          <p className="faint" style={{ padding: 14, fontSize: 11.5, lineHeight: 1.7 }}>
            Scan this project for vulnerable patterns, committed credentials and dependencies
            with published advisories. Nothing leaves the machine except the dependency check,
            which sends package names and versions and nothing else.
          </p>
        )}

        {result && !shown.length && result.findings.length > 0 && (
          <p className="faint" style={{ padding: 14, fontSize: 11.5 }}>
            {result.findings.length} finding{result.findings.length === 1 ? '' : 's'} below{' '}
            {minimum}. Lower the filter to see them.
          </p>
        )}

        {shown.map((finding) => (
          <FindingRow
            key={finding.id}
            finding={finding}
            open={expanded === finding.id}
            onToggle={() => setExpanded((current) => (current === finding.id ? null : finding.id))}
          />
        ))}
      </div>
    </div>
  )
}

const PHASE_LABEL = {
  sast: 'Code',
  secrets: 'Secrets',
  dependencies: 'Dependencies',
} as const

const PHASE_HINT = {
  sast: 'Patterns that commonly indicate a vulnerability — injection, weak crypto, disabled TLS checks',
  secrets: 'Credentials committed to the repository',
  dependencies: 'Packages whose installed version appears in a published advisory',
} as const

function FindingRow({
  finding,
  open,
  onToggle,
}: {
  finding: SecurityFinding
  open: boolean
  onToggle: () => void
}) {
  const Icon = SOURCE_ICON[finding.source]

  return (
    <div className={`security-finding ${open ? 'open' : ''}`}>
      <button className="security-head" onClick={onToggle} title={finding.detail}>
        <span className={`security-dot sev-${finding.severity}`} />
        <Icon size={12} className="faint" />
        <span className="security-title">{finding.title}</span>
        <span className={`security-confidence c-${finding.confidence}`}>
          {CONFIDENCE_LABEL[finding.confidence]}
        </span>
        <span className="faint mono security-where">
          {finding.relative}
          {finding.line > 1 || finding.source !== 'dependency' ? `:${finding.line}` : ''}
        </span>
      </button>

      {open && (
        <div className="security-body">
          <p>{finding.detail}</p>
          <pre className="mono security-excerpt">{finding.excerpt}</pre>

          <p className="security-fix">
            <strong>Fix</strong> {finding.remediation}
          </p>

          <div className="security-meta">
            {finding.cwe && (
              <button
                className="link-btn"
                title="Open the CWE entry for this weakness class"
                onClick={() =>
                  void window.nova.app.openExternal(
                    `https://cwe.mitre.org/data/definitions/${finding.cwe!.replace('CWE-', '')}.html`,
                  )
                }
              >
                {finding.cwe}
              </button>
            )}
            {(finding.references ?? []).slice(0, 4).map((reference) => (
              <button
                key={reference}
                className="link-btn"
                title="Open this advisory"
                onClick={() => void window.nova.app.openExternal(`https://osv.dev/vulnerability/${reference}`)}
              >
                {reference}
              </button>
            ))}
            {finding.fixedIn && <span className="faint">fixed in {finding.fixedIn}</span>}
            {finding.file && (
              <button
                className="link-btn"
                title="Open the file at this line"
                onClick={() =>
                  void useStore.getState().openFile(finding.file, { line: finding.line, column: finding.column })
                }
              >
                Open
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Spelled out rather than shown as a bare word: "possible" next to a critical
 * severity has to read as a caveat, not a label.
 */
const CONFIDENCE_LABEL: Record<Confidence, string> = {
  confirmed: 'confirmed',
  likely: 'likely — check it',
  possible: 'possible — may be fine',
}
