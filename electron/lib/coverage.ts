/**
 * Finding and parsing coverage reports.
 *
 * Every runner writes a different format, but almost all of them can be made to
 * write **lcov**, so that is the primary path. Istanbul's `coverage-final.json`
 * is handled too because it is what Jest and Vitest produce by default without
 * an extra reporter flag, and Go's `-coverprofile` because its format is
 * trivially different from everything else.
 *
 * Reports are located by convention rather than configuration: a user who has
 * just run tests with coverage should see it without first filling in a path.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { CoverageReport, FileCoverage } from '../../shared/coverage'
import { isInside } from './workspacePath'

/** Where runners drop reports, in the order we prefer them. */
const CANDIDATES = [
  'coverage/lcov.info',
  'coverage/coverage-final.json',
  'coverage/cobertura-coverage.xml',
  'lcov.info',
  'coverage.out',
  'coverage.txt',
  'target/site/jacoco/jacoco.xml',
  'build/reports/jacoco/test/jacocoTestReport.xml',
]

export async function findReport(root: string): Promise<string | null> {
  for (const candidate of CANDIDATES) {
    const full = path.join(root, candidate)
    try {
      await fs.access(full)
      return full
    } catch {
      // keep looking
    }
  }
  return null
}

export async function loadReport(root: string, file?: string): Promise<CoverageReport | null> {
  const source = file ?? (await findReport(root))
  if (!source) return null

  const text = await fs.readFile(source, 'utf8')
  const base = path.basename(source)

  let files: FileCoverage[]
  let format: CoverageReport['format']

  if (base.endsWith('.json')) {
    files = parseIstanbul(text, root)
    format = 'istanbul'
  } else if (base.endsWith('.xml')) {
    files = parseCobertura(text, root)
    format = 'cobertura'
  } else if (text.startsWith('mode:')) {
    files = parseGoProfile(text, root)
    format = 'go'
  } else {
    files = parseLcov(text, root)
    format = 'lcov'
  }

  const totals = files.reduce(
    (acc, f) => ({
      coveredLines: acc.coveredLines + f.coveredLines,
      totalLines: acc.totalLines + f.totalLines,
      coveredBranches: acc.coveredBranches + f.coveredBranches,
      totalBranches: acc.totalBranches + f.totalBranches,
      coveredFunctions: acc.coveredFunctions + f.coveredFunctions,
      totalFunctions: acc.totalFunctions + f.totalFunctions,
    }),
    { coveredLines: 0, totalLines: 0, coveredBranches: 0, totalBranches: 0, coveredFunctions: 0, totalFunctions: 0 },
  )

  return {
    at: Date.now(),
    source,
    format,
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
    totals,
  }
}

/** Fresh record, so every parser starts from the same shape. */
function emptyFile(file: string): FileCoverage {
  return {
    path: file,
    lines: {},
    uncovered: [],
    partial: [],
    coveredLines: 0,
    totalLines: 0,
    coveredBranches: 0,
    totalBranches: 0,
    coveredFunctions: 0,
    totalFunctions: 0,
  }
}

function finalise(file: FileCoverage): FileCoverage {
  const entries = Object.entries(file.lines)
  file.totalLines = entries.length
  file.coveredLines = entries.filter(([, hits]) => hits > 0).length
  file.uncovered = entries.filter(([, hits]) => hits === 0).map(([line]) => Number(line)).sort((a, b) => a - b)
  return file
}

/**
 * lcov: `SF:` starts a file, `DA:line,hits` is a line record, `BRDA` a branch,
 * `end_of_record` closes it. Records for the same file can appear more than
 * once (parallel test shards), so hits accumulate rather than overwrite.
 */
export function parseLcov(text: string, root: string): FileCoverage[] {
  const byPath = new Map<string, FileCoverage>()
  let current: FileCoverage | null = null
  /** Branch hits keyed `line:block:branch`, so re-runs merge correctly. */
  let branches = new Map<string, number>()

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith('SF:')) {
      const file = resolve(root, line.slice(3))
      current = byPath.get(file) ?? emptyFile(file)
      byPath.set(file, current)
      branches = new Map()
      continue
    }
    if (!current) continue

    if (line.startsWith('DA:')) {
      const [lineNo, hits] = line.slice(3).split(',')
      const n = Number(lineNo)
      if (!Number.isFinite(n)) continue
      current.lines[n] = (current.lines[n] ?? 0) + (Number(hits) || 0)
    } else if (line.startsWith('BRDA:')) {
      // BRDA:<line>,<block>,<branch>,<taken|->
      const [lineNo, block, branch, taken] = line.slice(5).split(',')
      const key = `${lineNo}:${block}:${branch}`
      const hits = taken === '-' ? 0 : Number(taken) || 0
      branches.set(key, (branches.get(key) ?? 0) + hits)
    } else if (line.startsWith('FNDA:')) {
      const [hits] = line.slice(5).split(',')
      if ((Number(hits) || 0) > 0) current.coveredFunctions++
    } else if (line.startsWith('FNF:')) {
      current.totalFunctions = Number(line.slice(4)) || current.totalFunctions
    } else if (line === 'end_of_record') {
      // Fold the branch map in now that the record is complete.
      const partial = new Set<number>()
      for (const [key, hits] of branches) {
        const lineNo = Number(key.split(':')[0])
        current.totalBranches++
        if (hits > 0) current.coveredBranches++
        else if (current.lines[lineNo] > 0) partial.add(lineNo)
      }
      current.partial = Array.from(partial).sort((a, b) => a - b)
      finalise(current)
      current = null
    }
  }

  for (const file of byPath.values()) if (file.totalLines === 0) finalise(file)
  return Array.from(byPath.values())
}

/** Istanbul's `coverage-final.json`, as written by Jest and Vitest. */
export function parseIstanbul(text: string, root: string): FileCoverage[] {
  let data: Record<string, IstanbulFile>
  try {
    data = JSON.parse(text)
  } catch {
    return []
  }

  const out: FileCoverage[] = []
  for (const [file, entry] of Object.entries(data)) {
    if (!entry || typeof entry !== 'object' || !entry.statementMap) continue
    const record = emptyFile(resolve(root, entry.path ?? file))

    // Istanbul counts statements, not lines; collapse to the line a statement
    // starts on, taking the highest hit count when several share a line.
    for (const [id, location] of Object.entries(entry.statementMap)) {
      const line = location?.start?.line
      if (!line) continue
      const hits = entry.s?.[id] ?? 0
      record.lines[line] = Math.max(record.lines[line] ?? 0, hits)
    }

    const partial = new Set<number>()
    for (const [id, counts] of Object.entries(entry.b ?? {})) {
      const location = entry.branchMap?.[id]
      const line = location?.loc?.start?.line ?? location?.line
      for (const count of counts) {
        record.totalBranches++
        if (count > 0) record.coveredBranches++
        // "Partial" only means anything on a line that ran at all. A line that
        // never executed is uncovered, and saying "some branches missed" about
        // it would understate the problem in the gutter.
        else if (line && (record.lines[line] ?? 0) > 0) partial.add(line)
      }
    }
    record.partial = Array.from(partial).sort((a, b) => a - b)

    for (const [id, hits] of Object.entries(entry.f ?? {})) {
      void id
      record.totalFunctions++
      if (hits > 0) record.coveredFunctions++
    }

    out.push(finalise(record))
  }
  return out
}

/** Go's `-coverprofile` output: `file.go:startLine.col,endLine.col stmts count`. */
export function parseGoProfile(text: string, root: string): FileCoverage[] {
  const byPath = new Map<string, FileCoverage>()

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('mode:')) continue

    const match = /^(.*):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$/.exec(line)
    if (!match) continue
    const [, file, startLine, endLine, count] = match

    // Go writes import paths, not filesystem paths; keep the tail that exists.
    const resolved = resolve(root, file)
    const record = byPath.get(resolved) ?? emptyFile(resolved)
    byPath.set(resolved, record)

    const hits = Number(count)
    for (let n = Number(startLine); n <= Number(endLine); n++) {
      record.lines[n] = Math.max(record.lines[n] ?? 0, hits)
    }
  }

  return Array.from(byPath.values()).map(finalise)
}

/**
 * Cobertura / JaCoCo XML, parsed with regex rather than a DOM.
 *
 * Pulling in an XML parser for two element shapes is not worth the dependency,
 * and the documents these tools emit are machine-generated and regular.
 */
export function parseCobertura(text: string, root: string): FileCoverage[] {
  const out: FileCoverage[] = []

  // Cobertura: <class filename="..."> containing <line number= hits=>
  const classRe = /<class\b[^>]*filename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g
  for (const match of text.matchAll(classRe)) {
    const record = emptyFile(resolve(root, match[1]))
    for (const line of match[2].matchAll(/<line\b[^>]*number="(\d+)"[^>]*hits="(\d+)"[^>]*\/?>/g)) {
      const n = Number(line[1])
      record.lines[n] = Math.max(record.lines[n] ?? 0, Number(line[2]))
    }
    out.push(finalise(record))
  }

  // JaCoCo: <sourcefile name="..."> containing <line nr= ci= mi=>
  const sourceRe = /<sourcefile\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/sourcefile>/g
  for (const match of text.matchAll(sourceRe)) {
    const record = emptyFile(resolve(root, match[1]))
    for (const line of match[2].matchAll(/<line\b[^>]*nr="(\d+)"[^>]*mi="(\d+)"[^>]*ci="(\d+)"[^>]*\/?>/g)) {
      record.lines[Number(line[1])] = Number(line[3]) > 0 ? Number(line[3]) : 0
    }
    out.push(finalise(record))
  }

  return out
}

/**
 * Where a coverage report's file name points, kept inside the project.
 *
 * A report is generated by a tool, but it is a *file in the repository* by the
 * time this reads it, and every path in it ends up somewhere the editor will
 * open. An absolute path was honoured verbatim, so a crafted `lcov.info` could
 * name any file on the machine and have Nova display it as project coverage.
 *
 * Absolute paths still have a legitimate use — most runners emit them for the
 * project's own files — so they are kept when they land inside the root and
 * re-based on their basename when they do not, rather than being refused.
 */
function resolve(root: string, file: string): string {
  const resolved = path.isAbsolute(file) ? file : path.resolve(root, file)
  if (isInside(root, resolved)) return resolved
  return path.join(root, path.basename(file))
}

interface IstanbulFile {
  path?: string
  statementMap?: Record<string, { start?: { line?: number } }>
  s?: Record<string, number>
  branchMap?: Record<string, { loc?: { start?: { line?: number } }; line?: number }>
  b?: Record<string, number[]>
  f?: Record<string, number>
}

/**
 * Extra arguments that make a runner emit coverage.
 *
 * Returning null means "this framework has no coverage mode we know of", which
 * the UI reports rather than silently running the tests without coverage.
 */
export function coverageArgs(frameworkId: string): string[] | null {
  switch (frameworkId) {
    case 'jest':
      return ['--coverage', '--coverageReporters=lcov', '--coverageReporters=json-summary']
    case 'vitest':
      return ['--coverage', '--coverage.reporter=lcov']
    case 'pytest':
      return ['--cov', '--cov-report=lcov']
    case 'go':
      return ['-coverprofile=coverage.out']
    case 'cargo':
      return null
    case 'rspec':
      return null
    case 'phpunit':
      return ['--coverage-clover', 'coverage/cobertura-coverage.xml']
    case 'gradle':
      return ['jacocoTestReport']
    case 'maven':
      return ['jacoco:report']
    default:
      return null
  }
}
