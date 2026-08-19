/**
 * The security scan, in the main process.
 *
 * Three phases over one project, reported as one list. They run in order of
 * how fast they answer — the two local phases finish before the network one
 * starts — and progress is broadcast as it goes, because a scan of a large
 * repository takes long enough that a frozen panel reads as a hang.
 *
 * Nothing here leaves the machine except the dependency phase, which sends
 * package names and versions to the advisory database and nothing else. No
 * source, no paths, no findings.
 */
import { ipcMain } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ScanOptions, ScanResult, SecurityFinding, Severity } from '../../shared/security'
import { isScannable, scanForVulnerabilities } from '../lib/sast'
import { scanForSecrets } from '../lib/secretScan'
import { auditDependencies, readDependencies } from '../lib/depAudit'
import { walk } from '../lib/scan'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

/** Beyond this a file is generated, minified or data — not code to review. */
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES = 20_000

/** Extensions worth reading. Everything else is skipped without opening it. */
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.php', '.go',
  '.java', '.kt', '.kts', '.scala', '.cs', '.swift', '.m', '.c', '.h', '.cpp',
  '.hpp', '.rs', '.ex', '.exs', '.pl', '.sh', '.bash', '.zsh', '.ps1', '.sql',
  '.html', '.vue', '.svelte', '.yml', '.yaml', '.json', '.toml', '.ini',
  '.env', '.cfg', '.conf', '.tf', '.tfvars', '.properties', '.xml', '.gradle',
])

/** Files with no extension that are still worth reading. */
const SOURCE_NAMES = new Set(['Dockerfile', 'Makefile', 'Procfile', '.env', '.npmrc', '.netrc'])

let running = false

export function registerSecurityHandlers(ctx: Ctx) {
  ipcMain.handle(
    'security:scan',
    async (_e, root: string, options: ScanOptions): Promise<ScanResult> => {
      const startedAt = Date.now()
      const result: ScanResult = {
        findings: [],
        startedAt,
        durationMs: 0,
        filesScanned: 0,
        notes: [],
      }

      if (!root) {
        result.notes.push('Open a project first.')
        return result
      }
      if (running) {
        result.notes.push('A scan is already running.')
        return result
      }
      running = true

      try {
        if (options.sast || options.secrets) {
          const files = await collectSourceFiles(root)
          for (const [index, file] of files.entries()) {
            // Progress is throttled: one broadcast per file would spend more
            // time in IPC than in scanning on a large tree.
            if (index % 25 === 0) {
              ctx.broadcast('security:progress', {
                phase: options.sast ? 'sast' : 'secrets',
                scanned: index,
                total: files.length,
                message: path.relative(root, file),
              })
            }

            let text: string
            try {
              const stat = await fs.stat(file)
              if (stat.size > MAX_FILE_BYTES) continue
              text = await fs.readFile(file, 'utf8')
            } catch {
              continue
            }
            // A NUL byte means this is binary that happened to have a source
            // extension — reading it as text produces nonsense matches.
            if (text.includes('\0')) continue

            const relative = path.relative(root, file)
            result.filesScanned++

            if (options.sast) {
              for (const found of scanForVulnerabilities(relative, text)) {
                result.findings.push({ ...found, id: newId(), source: 'sast', file })
              }
            }
            if (options.secrets) {
              for (const hit of scanForSecrets(relative, text)) {
                result.findings.push({
                  id: newId(),
                  source: 'secret',
                  severity: hit.severity,
                  confidence: hit.confidence,
                  rule: hit.rule,
                  title: hit.title,
                  detail: hit.detail,
                  remediation: hit.remediation,
                  file,
                  relative,
                  line: hit.line,
                  column: hit.column,
                  endColumn: hit.endColumn,
                  excerpt: hit.excerpt,
                  cwe: hit.cwe,
                })
              }
            }
          }
        }

        if (options.dependencies) {
          ctx.broadcast('security:progress', {
            phase: 'dependencies',
            scanned: 0,
            total: 0,
            message: 'Checking dependencies against published advisories',
          })

          const dependencies = await readDependencies(root)
          if (!dependencies.length) {
            result.notes.push('No lockfile found, so dependencies were not checked.')
          } else {
            const { findings, note } = await auditDependencies(root, dependencies)
            for (const finding of findings) result.findings.push({ ...finding, id: newId() })
            if (note) result.notes.push(note)
          }
        }

        result.findings.sort(compareFindings)
      } finally {
        running = false
        ctx.broadcast('security:progress', { phase: 'done', scanned: 0, total: 0 })
      }

      result.durationMs = Date.now() - startedAt
      return result
    },
  )

  ipcMain.handle('security:dependencies', (_e, root: string) => readDependencies(root))
}

/**
 * Worst first, and within a severity the ones that can be trusted first — a
 * confirmed medium is more worth someone's afternoon than a possible high.
 */
const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const CONFIDENCE_ORDER = ['confirmed', 'likely', 'possible']

function compareFindings(a: SecurityFinding, b: SecurityFinding): number {
  const bySeverity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  if (bySeverity !== 0) return bySeverity
  const byConfidence = CONFIDENCE_ORDER.indexOf(a.confidence) - CONFIDENCE_ORDER.indexOf(b.confidence)
  if (byConfidence !== 0) return byConfidence
  return a.relative.localeCompare(b.relative) || a.line - b.line
}

async function collectSourceFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for await (const file of walk(root, MAX_FILES)) {
    const relative = path.relative(root, file)
    if (!isScannable(relative)) continue
    const name = path.basename(file)
    const extension = path.extname(file).toLowerCase()
    if (!SOURCE_EXTENSIONS.has(extension) && !SOURCE_NAMES.has(name) && !name.startsWith('.env')) {
      continue
    }
    files.push(file)
  }
  return files.sort()
}

function newId() {
  return `f-${crypto.randomUUID()}`
}
