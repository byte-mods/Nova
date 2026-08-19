/**
 * Security findings: what was found, where, and what to do about it.
 *
 * Three scanners feed one shape, because a developer wants one list of "things
 * wrong with this project" rather than three tools to remember to run. What
 * differs between them is only how a finding is proved, which is what
 * `confidence` records.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

/** Which scanner produced a finding, since they fail in different ways. */
export type FindingSource = 'sast' | 'secret' | 'dependency'

/**
 * How much a finding deserves to be trusted.
 *
 * A pattern scanner cannot know whether a string reaches a sink, so saying so
 * is more useful than pretending. `confirmed` is reserved for findings with
 * evidence — a package version inside a published advisory's range, say.
 */
export type Confidence = 'confirmed' | 'likely' | 'possible'

export interface SecurityFinding {
  id: string
  source: FindingSource
  severity: Severity
  confidence: Confidence
  /** Short rule name, e.g. `sql-injection`. */
  rule: string
  title: string
  /** What is wrong, in a sentence. */
  detail: string
  /** What to do instead. Every rule has one — a finding with no fix is noise. */
  remediation: string
  /** Absolute path. Empty for a dependency finding, which is not in a file. */
  file: string
  /** Path relative to the project root, for display. */
  relative: string
  /** 1-based. */
  line: number
  column: number
  endColumn: number
  /** The offending line, with any secret already redacted. */
  excerpt: string
  /** `CWE-89`, for the rules that map cleanly to one. */
  cwe?: string
  /** Advisory ids for a dependency finding, e.g. `GHSA-…`, `CVE-…`. */
  references?: string[]
  /** Package and version, for a dependency finding. */
  packageName?: string
  packageVersion?: string
  fixedIn?: string
}

export interface ScanProgress {
  phase: 'sast' | 'secrets' | 'dependencies' | 'done'
  /** Files scanned so far, for the phases that walk the tree. */
  scanned: number
  total: number
  message?: string
}

export interface ScanResult {
  findings: SecurityFinding[]
  startedAt: number
  durationMs: number
  filesScanned: number
  /** Set when a phase could not run at all — no network, no lockfile. */
  notes: string[]
}

export interface ScanOptions {
  sast: boolean
  secrets: boolean
  dependencies: boolean
}
