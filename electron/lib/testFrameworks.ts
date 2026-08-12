import type { TestEvent } from '../../shared/types'

export interface TestScope {
  kind: 'all' | 'file' | 'name'
  /** Absolute path, for `file` and `name`. */
  file?: string
  /** Test name, for `name`. */
  name?: string
}

export interface FrameworkContext {
  root: string
  /** Files present at the project root, for detection. */
  rootFiles: Set<string>
  packageJson: { scripts?: Record<string, string>; devDependencies?: Record<string, string>; dependencies?: Record<string, string> } | null
  relative: (file: string) => string
}

export interface TestFramework {
  id: string
  label: string
  detect: (ctx: FrameworkContext) => boolean
  /** The command to run for a scope. */
  command: (scope: TestScope, ctx: FrameworkContext) => { command: string; args: string[] }
  /**
   * Used when the primary command is not on PATH. Test runners are frequently
   * importable without their launcher script being installed globally
   * (`python3 -m pytest`, `npx jest`), so this keeps them usable.
   */
  fallback?: (scope: TestScope, ctx: FrameworkContext) => { command: string; args: string[] }
  /**
   * Incremental parser. Called with each stdout/stderr chunk split into lines,
   * returns any test events recognised. `flush` is called at process exit with
   * the complete output, for frameworks that only emit JSON at the end.
   */
  parseLine?: (line: string) => TestEvent[]
  parseFinal?: (output: string) => TestEvent[]
}

/* ---------------- Go ---------------- */

const go: TestFramework = {
  id: 'go',
  label: 'go test',
  detect: (ctx) => ctx.rootFiles.has('go.mod'),
  command: (scope, ctx) => {
    if (scope.kind === 'name' && scope.name) {
      return { command: 'go', args: ['test', '-json', '-run', `^${escapeRe(scope.name)}$`, './...'] }
    }
    if (scope.kind === 'file' && scope.file) {
      const dir = ctx.relative(scope.file).split('/').slice(0, -1).join('/') || '.'
      return { command: 'go', args: ['test', '-json', `./${dir}`] }
    }
    return { command: 'go', args: ['test', '-json', './...'] }
  },
  parseLine: (line) => {
    if (!line.startsWith('{')) return []
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      return []
    }
    if (!event.Test) return []
    const id = `${event.Package}.${event.Test}`
    switch (event.Action) {
      case 'run':
        return [{ type: 'start', id, name: event.Test, suite: event.Package }]
      case 'pass':
        return [{ type: 'result', id, name: event.Test, suite: event.Package, status: 'pass', durationMs: Math.round((event.Elapsed ?? 0) * 1000) }]
      case 'fail':
        return [{ type: 'result', id, name: event.Test, suite: event.Package, status: 'fail', durationMs: Math.round((event.Elapsed ?? 0) * 1000) }]
      case 'skip':
        return [{ type: 'result', id, name: event.Test, suite: event.Package, status: 'skip' }]
      case 'output':
        return event.Output?.trim() ? [{ type: 'output', id, text: event.Output }] : []
      default:
        return []
    }
  },
}

/* ---------------- Rust ---------------- */

const RUST_LINE = /^test\s+(\S+)\s+\.\.\.\s+(ok|FAILED|ignored)/

const cargo: TestFramework = {
  id: 'cargo',
  label: 'cargo test',
  detect: (ctx) => ctx.rootFiles.has('Cargo.toml'),
  command: (scope) => {
    const args = ['test']
    if (scope.kind === 'name' && scope.name) args.push(scope.name)
    args.push('--', '--nocapture')
    return { command: 'cargo', args }
  },
  parseLine: (line) => {
    const match = RUST_LINE.exec(line.trim())
    if (!match) return []
    const [, name, outcome] = match
    return [
      {
        type: 'result',
        id: name,
        name,
        status: outcome === 'ok' ? 'pass' : outcome === 'ignored' ? 'skip' : 'fail',
      },
    ]
  },
  /** libtest prints each failure's captured output under `---- name stdout ----`. */
  parseFinal: (output) => {
    const events: TestEvent[] = []
    const parts = output.split(/\n-{4}\s+(\S+)\s+stdout\s+-{4}\n/)
    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i]
      const body = (parts[i + 1] ?? '').split(/\nfailures:/)[0].trim()
      if (!body) continue
      events.push({ type: 'result', id: name, name, status: 'fail', message: body.slice(0, 4000) })
    }
    return events
  },
}

/* ---------------- Python ---------------- */

const PYTEST_LINE = /^(\S+?)::(\S+?)\s+(PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)/

const pytest: TestFramework = {
  id: 'pytest',
  label: 'pytest',
  detect: (ctx) =>
    ctx.rootFiles.has('pytest.ini') ||
    ctx.rootFiles.has('pyproject.toml') ||
    ctx.rootFiles.has('setup.cfg') ||
    ctx.rootFiles.has('tox.ini') ||
    ctx.rootFiles.has('conftest.py'),
  command: (scope, ctx) => {
    // `-rf` prints a one-line reason per failure, which pairs each traceback
    // with its full `file::name` id.
    const args = ['-v', '--no-header', '-rf', '--color=no']
    if (scope.kind === 'file' && scope.file) args.push(ctx.relative(scope.file))
    else if (scope.kind === 'name' && scope.file && scope.name) {
      args.push(`${ctx.relative(scope.file)}::${scope.name}`)
    }
    return { command: 'pytest', args }
  },
  fallback: (scope, ctx) => {
    const { args } = pytest.command(scope, ctx)
    return { command: 'python3', args: ['-m', 'pytest', ...args] }
  },
  parseLine: (line) => {
    const match = PYTEST_LINE.exec(line.trim())
    if (!match) return []
    const [, file, name, outcome] = match
    const status =
      outcome === 'PASSED' || outcome === 'XPASS'
        ? 'pass'
        : outcome === 'SKIPPED' || outcome === 'XFAIL'
          ? 'skip'
          : 'fail'
    return [{ type: 'result', id: `${file}::${name}`, name, suite: file, status }]
  },
  /**
   * Attaches each failure's traceback. pytest prints them in a FAILURES section
   * keyed by test name only, so the ids are recovered from the verbose lines.
   */
  parseFinal: (output) => {
    const section = output.split(/=+\s*FAILURES\s*=+/)[1]
    if (!section) return []

    const idByName = new Map<string, { id: string; suite: string }>()
    for (const line of output.split('\n')) {
      const match = PYTEST_LINE.exec(line.trim())
      if (match) idByName.set(match[2], { id: `${match[1]}::${match[2]}`, suite: match[1] })
    }

    const events: TestEvent[] = []
    // `______ test_name ______` separates the blocks.
    const parts = section.split(/\n_{3,}\s+(\S+)\s+_{3,}\n/)
    for (let i = 1; i < parts.length; i += 2) {
      const name = parts[i]
      const body = (parts[i + 1] ?? '').split(/\n=+\s*short test summary/)[0].trim()
      const known = idByName.get(name)
      if (!known || !body) continue
      events.push({
        type: 'result',
        id: known.id,
        name,
        suite: known.suite,
        status: 'fail',
        message: body.slice(0, 4000),
      })
    }
    return events
  },
}

/* ---------------- JavaScript / TypeScript ---------------- */

function jsRunner(id: string, label: string, bin: string): TestFramework {
  return {
    id,
    label,
    detect: (ctx) => {
      const deps = { ...ctx.packageJson?.dependencies, ...ctx.packageJson?.devDependencies }
      return Boolean(deps?.[bin])
    },
    command: (scope, ctx) => {
      const args = ['--yes', bin]
      if (bin === 'vitest') args.push('run')
      args.push('--reporter=json')
      if (bin === 'jest') {
        args.splice(args.indexOf('--reporter=json'), 1)
        args.push('--json')
      }
      if (scope.kind === 'file' && scope.file) args.push(ctx.relative(scope.file))
      if (scope.kind === 'name' && scope.name) args.push('-t', scope.name)
      return { command: 'npx', args }
    },
    // Both print one JSON document at the end; stream output is human text.
    parseFinal: (output) => {
      const start = output.indexOf('{"')
      if (start === -1) return []
      let parsed: any
      try {
        parsed = JSON.parse(output.slice(start, output.lastIndexOf('}') + 1))
      } catch {
        return []
      }
      const events: TestEvent[] = []
      // Jest shape
      for (const file of parsed.testResults ?? []) {
        const suite = file.name ?? file.testFilePath ?? ''
        for (const assertion of file.assertionResults ?? file.testResults ?? []) {
          const name = assertion.fullName ?? assertion.title ?? assertion.name ?? ''
          const raw = assertion.status ?? assertion.state
          events.push({
            type: 'result',
            id: `${suite}::${name}`,
            name,
            suite,
            status: raw === 'passed' ? 'pass' : raw === 'pending' || raw === 'skipped' ? 'skip' : 'fail',
            durationMs: assertion.duration ?? undefined,
            message: (assertion.failureMessages ?? []).join('\n') || undefined,
          })
        }
      }
      return events
    },
  }
}

const vitest = jsRunner('vitest', 'vitest', 'vitest')
const jest = jsRunner('jest', 'jest', 'jest')

/* ---------------- Ruby / PHP / Java ---------------- */

const rspec: TestFramework = {
  id: 'rspec',
  label: 'rspec',
  detect: (ctx) => ctx.rootFiles.has('.rspec') || ctx.rootFiles.has('spec'),
  command: (scope, ctx) => {
    const args: string[] = []
    if (scope.kind === 'file' && scope.file) args.push(ctx.relative(scope.file))
    if (scope.kind === 'name' && scope.name) args.push('-e', scope.name)
    return { command: 'rspec', args }
  },
}

const phpunit: TestFramework = {
  id: 'phpunit',
  label: 'PHPUnit',
  detect: (ctx) => ctx.rootFiles.has('phpunit.xml') || ctx.rootFiles.has('phpunit.xml.dist'),
  command: (scope, ctx) => {
    const args: string[] = []
    if (scope.kind === 'file' && scope.file) args.push(ctx.relative(scope.file))
    if (scope.kind === 'name' && scope.name) args.push('--filter', scope.name)
    return { command: './vendor/bin/phpunit', args }
  },
}

const gradle: TestFramework = {
  id: 'gradle',
  label: 'Gradle test',
  detect: (ctx) => ctx.rootFiles.has('build.gradle') || ctx.rootFiles.has('build.gradle.kts'),
  command: (scope) => {
    const args = ['test']
    if (scope.kind === 'name' && scope.name) args.push('--tests', scope.name)
    return { command: './gradlew', args }
  },
  fallback: (scope, ctx) => ({ command: 'gradle', args: gradle.command(scope, ctx).args }),
}

const maven: TestFramework = {
  id: 'maven',
  label: 'Maven test',
  detect: (ctx) => ctx.rootFiles.has('pom.xml'),
  command: (scope) => {
    const args = ['test']
    if (scope.kind === 'name' && scope.name) args.push(`-Dtest=${scope.name}`)
    return { command: 'mvn', args }
  },
}

/** Last resort: whatever `npm test` is wired to. */
const npmScript: TestFramework = {
  id: 'npm',
  label: 'npm test',
  detect: (ctx) => Boolean(ctx.packageJson?.scripts?.test),
  command: () => ({ command: 'npm', args: ['test', '--silent'] }),
}

export const FRAMEWORKS: TestFramework[] = [
  go,
  cargo,
  vitest,
  jest,
  pytest,
  rspec,
  phpunit,
  gradle,
  maven,
  npmScript,
]

export function detectFrameworks(ctx: FrameworkContext) {
  return FRAMEWORKS.filter((framework) => framework.detect(ctx))
}

function escapeRe(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* ---------------- test declaration detection ---------------- */

/** Recognises test declarations so the gutter can offer a run button. */
export const TEST_PATTERNS: Record<string, RegExp[]> = {
  go: [/^func\s+(Test\w+)\s*\(/, /^func\s+(Benchmark\w+)\s*\(/, /^func\s+(Fuzz\w+)\s*\(/],
  rust: [/^\s*fn\s+(\w+)\s*\(/],
  python: [/^\s*(?:async\s+)?def\s+(test_\w+)/, /^\s*class\s+(Test\w+)/],
  typescript: [
    /^\s*(?:it|test)(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]/,
    /^\s*describe(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]/,
  ],
  javascript: [
    /^\s*(?:it|test)(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]/,
    /^\s*describe(?:\.\w+)?\s*\(\s*['"`](.+?)['"`]/,
  ],
  ruby: [/^\s*(?:it|describe|context)\s+['"](.+?)['"]/],
  java: [/^\s*(?:public\s+)?void\s+(test\w+|\w+Test)\s*\(/],
  php: [/^\s*public\s+function\s+(test\w+)\s*\(/],
}

/** For Rust, only `fn`s directly preceded by #[test] count. */
export function findTestDeclarations(language: string, text: string) {
  const patterns = TEST_PATTERNS[language]
  if (!patterns) return []
  const lines = text.split('\n')
  const found: { name: string; line: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    if (language === 'rust') {
      const previous = (lines[i - 1] ?? '').trim()
      if (!/^#\[(?:test|tokio::test|test_case.*)\]/.test(previous)) continue
    }
    for (const pattern of patterns) {
      const match = pattern.exec(lines[i])
      if (match?.[1]) {
        found.push({ name: match[1], line: i + 1 })
        break
      }
    }
  }
  return found
}
