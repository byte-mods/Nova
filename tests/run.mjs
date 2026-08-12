/**
 * Builds the main-process modules the suites exercise, then runs them.
 *
 * Suites are split in two:
 *   - offline: pure logic, always runnable
 *   - tools:   require real external tooling (clangd, rust-analyzer, debugpy)
 * Live-app suites (verify-*) need the IDE running with NOVA_DEBUG_PORT and are
 * not part of `npm test`.
 */
import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { BUILD, REPO, TMP } from './env.mjs'

const exec = promisify(execFile)

const BUNDLES = [
  ['electron/lib/parseSymbols.ts', 'parseSymbols'],
  ['electron/lib/projectIndex.ts', 'projectIndex'],
  ['electron/lib/testFrameworks.ts', 'testFrameworks'],
  ['electron/lib/debugSession.ts', 'debugSession'],
  ['electron/lib/lspManager.ts', 'lspManager'],
  ['src/lib/applyEdits.ts', 'applyEdits'],
  ['src/lib/refactor/index.ts', 'refactor'],
  ['src/lib/explain.ts', 'explain'],
]

const OFFLINE = ['test-parse', 'test-edits', 'test-frameworks', 'test-index', 'test-refactor', 'test-explain']
const TOOLS = ['test-lsp', 'test-hier', 'test-dap-py']

const only = process.argv[2]
const suites = only === 'offline' ? OFFLINE : only === 'tools' ? TOOLS : [...OFFLINE, ...TOOLS]

await mkdir(BUILD, { recursive: true })
process.stdout.write(`building ${BUNDLES.length} modules → ${BUILD}\n`)
for (const [src, out] of BUNDLES) {
  await exec(
    'npx',
    ['esbuild', src, '--bundle', '--format=esm', '--platform=node', `--outfile=${BUILD}/${out}.js`, '--log-level=error'],
    { cwd: REPO },
  )
}

let failed = 0
for (const suite of suites) {
  process.stdout.write(`\n── ${suite} ──\n`)
  try {
    const { stdout } = await exec('node', [`tests/${suite}.mjs`], {
      cwd: REPO,
      env: { ...process.env, NOVA_TEST_TMP: TMP },
      maxBuffer: 16 * 1024 * 1024,
    })
    process.stdout.write(stdout)
  } catch (err) {
    failed++
    process.stdout.write(err.stdout ?? '')
    process.stdout.write(err.stderr ?? '')
  }
}

process.stdout.write(failed ? `\n${failed} suite(s) failed\n` : '\nall suites passed\n')
process.exit(failed ? 1 : 0)
