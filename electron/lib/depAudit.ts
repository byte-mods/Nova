/**
 * Known vulnerabilities in the project's dependencies.
 *
 * Advisories come from OSV.dev, which is the aggregate of GitHub's database,
 * the language ecosystems' own, and the national CVE feeds — one query rather
 * than one per registry. It is queried in batch, and the request carries only
 * package names and versions: nothing about the project, and no source.
 *
 * A dependency finding is the one kind this tool can report as `confirmed`.
 * Everything else here is a pattern that might mean something; this is a
 * version number sitting inside a published advisory's affected range.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SecurityFinding, Severity } from '../../shared/security'

/** OSV's batch endpoint, which takes up to 1000 queries at a time. */
const OSV_ENDPOINT = 'https://api.osv.dev/v1/querybatch'
const OSV_DETAIL = 'https://api.osv.dev/v1/vulns'
const BATCH_LIMIT = 500

export interface Dependency {
  name: string
  version: string
  /** OSV's name for the registry this came from. */
  ecosystem: 'npm' | 'PyPI' | 'crates.io' | 'Go' | 'RubyGems' | 'Packagist' | 'Maven'
  /** Which lockfile it was read from, for the finding's location. */
  lockfile: string
  /** Whether it is only needed to build or test. */
  dev: boolean
}

/* ---------------- reading lockfiles ---------------- */

/**
 * Reads the lockfiles present. A lockfile rather than a manifest because it
 * pins exact versions — a manifest range cannot be matched against an advisory
 * without resolving it, and resolving it means running the package manager.
 */
/**
 * Every dependency the project pins, and the lockfiles that could not be read.
 *
 * The two travel together because reporting the first without the second is
 * what made a malformed `package-lock.json` look like a project with no
 * dependencies, and therefore no vulnerabilities.
 */
export async function readDependenciesDetailed(
  root: string,
): Promise<{ dependencies: Dependency[]; unreadable: string[] }> {
  const unreadable: string[] = []
  const dependencies = await collect(root, unreadable)
  return { dependencies, unreadable }
}

export async function readDependencies(root: string): Promise<Dependency[]> {
  return (await readDependenciesDetailed(root)).dependencies
}

async function collect(root: string, unreadable: string[]): Promise<Dependency[]> {
  const found: Dependency[] = []

  for (const [file, parse] of [
    ['package-lock.json', parsePackageLock],
    ['pnpm-lock.yaml', parsePnpmLock],
    ['yarn.lock', parseYarnLock],
    ['requirements.txt', parseRequirements],
    ['poetry.lock', parsePoetryLock],
    ['Cargo.lock', parseCargoLock],
    ['go.sum', parseGoSum],
    ['Gemfile.lock', parseGemfileLock],
    ['composer.lock', parseComposerLock],
  ] as const) {
    let text: string
    try {
      text = await fs.readFile(path.join(root, file), 'utf8')
    } catch (err) {
      // Not present is the normal case for most of them. Present but
      // unreadable is not, and must not be silently the same thing.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') unreadable.push(file)
      continue
    }

    const before = found.length
    found.push(...parse(text, file))
    // A lockfile that exists and yields nothing did not parse. Left silent,
    // this is how a scanner reports a project as clean without having checked
    // a single one of its dependencies — the worst answer it could give.
    if (found.length === before && text.trim()) unreadable.push(file)
  }

  // The same package can appear at several versions in one tree; each version
  // is a distinct thing to check.
  const seen = new Set<string>()
  return found.filter((dependency) => {
    const key = `${dependency.ecosystem}|${dependency.name}|${dependency.version}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parsePackageLock(text: string, lockfile: string): Dependency[] {
  let parsed: {
    packages?: Record<string, { version?: string; dev?: boolean }>
    dependencies?: Record<string, { version?: string; dev?: boolean }>
  }
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }

  const out: Dependency[] = []

  // v2/v3 keep everything under `packages`, keyed by install path.
  for (const [location, entry] of Object.entries(parsed.packages ?? {})) {
    if (!location || !entry?.version) continue
    const name = location.replace(/^.*?node_modules\//, '')
    if (!name) continue
    out.push({ name, version: entry.version, ecosystem: 'npm', lockfile, dev: Boolean(entry.dev) })
  }

  // v1 has a flat `dependencies` map instead.
  if (!out.length) {
    for (const [name, entry] of Object.entries(parsed.dependencies ?? {})) {
      if (!entry?.version) continue
      out.push({ name, version: entry.version, ecosystem: 'npm', lockfile, dev: Boolean(entry.dev) })
    }
  }

  return out
}

export function parsePnpmLock(text: string, lockfile: string): Dependency[] {
  const out: Dependency[] = []
  // `/package/1.2.3:` or `/@scope/package@1.2.3:` depending on lockfile version.
  const pattern = /^\s{2}\/?(@?[^/\s@][^\s@]*(?:\/[^\s@]+)?)[@/](\d[^\s:(]*)/gm
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    out.push({ name: match[1], version: match[2], ecosystem: 'npm', lockfile, dev: false })
  }
  return out
}

export function parseYarnLock(text: string, lockfile: string): Dependency[] {
  const out: Dependency[] = []
  const blocks = text.split(/\n(?=\S)/)

  for (const block of blocks) {
    const header = block.split('\n')[0]
    const version = /^\s+version:?\s+"?([^"\s]+)"?/m.exec(block)?.[1]
    if (!version) continue
    // `"@scope/name@^1.0.0":` or `name@^1.0.0, name@~1.1:`
    const name = /^"?(@?[^@\s"]+(?:\/[^@\s"]+)?)@/.exec(header.trim())?.[1]
    if (!name) continue
    out.push({ name, version, ecosystem: 'npm', lockfile, dev: false })
  }
  return out
}

export function parseRequirements(text: string, lockfile: string): Dependency[] {
  const out: Dependency[] = []
  for (const line of text.split(/\r?\n/)) {
    const clean = line.split('#')[0].trim()
    if (!clean || clean.startsWith('-')) continue
    // Only `==` pins a version; a range cannot be checked without resolving it.
    const match = /^([A-Za-z0-9._-]+)\s*==\s*([A-Za-z0-9._-]+)/.exec(clean)
    if (!match) continue
    out.push({ name: match[1], version: match[2], ecosystem: 'PyPI', lockfile, dev: false })
  }
  return out
}

export function parsePoetryLock(text: string, lockfile: string): Dependency[] {
  const out: Dependency[] = []
  for (const block of text.split(/\[\[package\]\]/).slice(1)) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    const category = /^\s*category\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    if (name && version) {
      out.push({ name, version, ecosystem: 'PyPI', lockfile, dev: category === 'dev' })
    }
  }
  return out
}

export function parseCargoLock(text: string, lockfile: string): Dependency[] {
  const out: Dependency[] = []
  for (const block of text.split(/\[\[package\]\]/).slice(1)) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    if (name && version) out.push({ name, version, ecosystem: 'crates.io', lockfile, dev: false })
  }
  return out
}

export function parseGoSum(text: string, lockfile: string): Dependency[] {
  const out: Dependency[] = []
  for (const line of text.split(/\r?\n/)) {
    // `module v1.2.3 h1:…` — the `/go.mod` lines repeat the same version.
    const match = /^(\S+)\s+(v[^\s/]+)\s+h1:/.exec(line)
    if (!match) continue
    out.push({ name: match[1], version: match[2], ecosystem: 'Go', lockfile, dev: false })
  }
  return out
}

export function parseGemfileLock(text: string, lockfile: string): Dependency[] {
  const out: Dependency[] = []
  const specs = /GEM\n(?:.*\n)*?\s+specs:\n((?:\s{4}\S.*\n)+)/.exec(text)?.[1] ?? ''
  for (const line of specs.split('\n')) {
    const match = /^\s{4}(\S+)\s+\(([^)]+)\)/.exec(line)
    if (!match) continue
    out.push({ name: match[1], version: match[2], ecosystem: 'RubyGems', lockfile, dev: false })
  }
  return out
}

export function parseComposerLock(text: string, lockfile: string): Dependency[] {
  let parsed: { packages?: { name?: string; version?: string }[]; 'packages-dev'?: { name?: string; version?: string }[] }
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const out: Dependency[] = []
  for (const [list, dev] of [
    [parsed.packages ?? [], false],
    [parsed['packages-dev'] ?? [], true],
  ] as const) {
    for (const entry of list) {
      if (!entry.name || !entry.version) continue
      out.push({
        name: entry.name,
        version: entry.version.replace(/^v/, ''),
        ecosystem: 'Packagist',
        lockfile,
        dev,
      })
    }
  }
  return out
}

/* ---------------- advisories ---------------- */

interface OsvVulnerability {
  id?: string
  summary?: string
  details?: string
  aliases?: string[]
  severity?: { type?: string; score?: string }[]
  database_specific?: { severity?: string }
  affected?: {
    package?: { name?: string; ecosystem?: string }
    ranges?: { events?: { introduced?: string; fixed?: string }[] }[]
  }[]
}

export interface AuditOptions {
  /** Skips packages only needed to build or test. */
  productionOnly?: boolean
  timeoutMs?: number
  /** Injected by the tests, so the suite does not depend on the network. */
  fetchImpl?: typeof fetch
}

/**
 * Looks every dependency up and turns the hits into findings.
 *
 * Returns a note rather than throwing when the network is unavailable: a
 * security scan that fails entirely because one of three phases could not
 * reach the internet is less useful than one that says so and reports the
 * other two.
 */
export async function auditDependencies(
  root: string,
  dependencies: Dependency[],
  options: AuditOptions = {},
): Promise<{ findings: Omit<SecurityFinding, 'id'>[]; note?: string }> {
  const wanted = options.productionOnly ? dependencies.filter((d) => !d.dev) : dependencies
  if (!wanted.length) return { findings: [] }

  const doFetch = options.fetchImpl ?? fetch
  const findings: Omit<SecurityFinding, 'id'>[] = []
  const details = new Map<string, OsvVulnerability>()

  for (let offset = 0; offset < wanted.length; offset += BATCH_LIMIT) {
    const slice = wanted.slice(offset, offset + BATCH_LIMIT)
    let response: Response
    try {
      response = await doFetch(OSV_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queries: slice.map((d) => ({
            version: d.version,
            package: { name: d.name, ecosystem: d.ecosystem },
          })),
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      })
    } catch (err) {
      return {
        findings,
        note: `Could not reach the advisory database: ${(err as Error).message}. Dependencies were not checked.`,
      }
    }

    if (!response.ok) {
      return { findings, note: `The advisory database returned ${response.status}. Dependencies were not checked.` }
    }

    let payload: { results?: { vulns?: OsvVulnerability[] }[] }
    try {
      payload = await response.json()
    } catch {
      return { findings, note: 'The advisory database returned something unreadable.' }
    }

    for (const [index, result] of (payload.results ?? []).entries()) {
      const dependency = slice[index]
      if (!dependency || !result?.vulns?.length) continue
      for (const vulnerability of result.vulns) {
        if (vulnerability.id) details.set(vulnerability.id, vulnerability)
        findings.push(toFinding(root, dependency, vulnerability))
      }
    }
  }

  // The batch endpoint returns ids only, so summaries are fetched for what was
  // actually found — a handful of requests rather than one per dependency.
  await enrich(findings, details, doFetch, options.timeoutMs ?? 30_000)

  return { findings }
}

async function enrich(
  findings: Omit<SecurityFinding, 'id'>[],
  known: Map<string, OsvVulnerability>,
  doFetch: typeof fetch,
  timeoutMs: number,
) {
  const missing = [...new Set(findings.flatMap((f) => f.references ?? []))]
    .filter((id) => !known.get(id)?.summary)
    // Enough to be useful without turning a scan into a hundred requests.
    .slice(0, 40)

  await Promise.all(
    missing.map(async (id) => {
      try {
        const response = await doFetch(`${OSV_DETAIL}/${id}`, {
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (response.ok) known.set(id, (await response.json()) as OsvVulnerability)
      } catch {
        // A missing summary is cosmetic; the advisory id is still actionable.
      }
    }),
  )

  for (const finding of findings) {
    const id = finding.references?.[0]
    const vulnerability = id ? known.get(id) : undefined
    if (!vulnerability) continue
    if (vulnerability.summary) finding.title = `${finding.packageName}: ${vulnerability.summary}`
    if (vulnerability.details) finding.detail = vulnerability.details.slice(0, 500)
    const fixed = fixedVersion(vulnerability, finding.packageName ?? '')
    if (fixed) {
      finding.fixedIn = fixed
      finding.remediation = `Upgrade ${finding.packageName} to ${fixed} or later.`
    }
    const severity = severityOf(vulnerability)
    if (severity) finding.severity = severity
  }
}

function toFinding(
  root: string,
  dependency: Dependency,
  vulnerability: OsvVulnerability,
): Omit<SecurityFinding, 'id'> {
  const ids = [vulnerability.id, ...(vulnerability.aliases ?? [])].filter(
    (id): id is string => Boolean(id),
  )
  const fixed = fixedVersion(vulnerability, dependency.name)

  return {
    source: 'dependency',
    // Only downgraded from the advisory's own rating once it is known; until
    // then `high` avoids under-reporting something that turns out to be critical.
    severity: severityOf(vulnerability) ?? 'high',
    // The version is inside a published affected range. This is the one thing
    // the whole scanner can state as fact.
    confidence: 'confirmed',
    rule: 'vulnerable-dependency',
    title: `${dependency.name} ${dependency.version} has a known vulnerability`,
    detail: vulnerability.summary ?? `${ids[0] ?? 'An advisory'} affects this version.`,
    remediation: fixed
      ? `Upgrade ${dependency.name} to ${fixed} or later.`
      : `No fixed version is published yet. Check ${ids[0] ?? 'the advisory'} for a workaround.`,
    file: path.join(root, dependency.lockfile),
    relative: dependency.lockfile,
    line: 1,
    column: 1,
    endColumn: 1,
    excerpt: `${dependency.name}@${dependency.version}${dependency.dev ? ' (dev)' : ''}`,
    references: ids,
    packageName: dependency.name,
    packageVersion: dependency.version,
    fixedIn: fixed,
  }
}

/** The first `fixed` event for this package, which is what to upgrade to. */
function fixedVersion(vulnerability: OsvVulnerability, name: string): string | undefined {
  for (const affected of vulnerability.affected ?? []) {
    if (affected.package?.name && affected.package.name !== name) continue
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) return event.fixed
      }
    }
  }
  return undefined
}

/**
 * The advisory's own rating, from the CVSS vector where there is one.
 *
 * Thresholds are the standard CVSS v3 bands, so a finding here means the same
 * thing it means everywhere else.
 */
function severityOf(vulnerability: OsvVulnerability): Severity | undefined {
  const label = vulnerability.database_specific?.severity?.toLowerCase()
  if (label === 'critical' || label === 'high' || label === 'moderate' || label === 'low') {
    return label === 'moderate' ? 'medium' : (label as Severity)
  }

  const vector = vulnerability.severity?.find((s) => s.type?.startsWith('CVSS'))?.score
  if (!vector) return undefined

  const score = cvssBaseScore(vector)
  if (score === null) return undefined
  if (score >= 9) return 'critical'
  if (score >= 7) return 'high'
  if (score >= 4) return 'medium'
  return 'low'
}

/**
 * Reads a CVSS base score.
 *
 * OSV gives either a numeric score or the full vector string. Only the numeric
 * form is read; computing a base score from a vector means implementing the
 * whole CVSS formula, and getting that subtly wrong would mislabel every
 * finding rather than just skipping a few.
 */
export function cvssBaseScore(vector: string): number | null {
  const direct = Number(vector)
  if (Number.isFinite(direct)) return direct
  const embedded = /\/?(\d+\.\d+)$/.exec(vector.trim())
  return embedded ? Number(embedded[1]) : null
}
