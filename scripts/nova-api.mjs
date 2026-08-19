#!/usr/bin/env node
/**
 * Runs `.http` files outside the IDE, for CI.
 *
 * The whole point of writing assertions next to a request is that they run
 * somewhere other than the editor. This is that somewhere: same parser, same
 * executor, same script runtime, same cookie jar — so a suite that passes in
 * the panel passes here, and the reverse. A separate implementation would
 * eventually disagree with the one people actually watch.
 *
 *   node scripts/nova-api.mjs api/                 every .http file under api/
 *   node scripts/nova-api.mjs api/orders.http --env staging
 *   node scripts/nova-api.mjs api/ --bail --reporter json
 *
 * Exits non-zero when anything failed, which is the only part CI reads.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2)
if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
  console.log(`nova-api — run .http files and their assertions

  node scripts/nova-api.mjs <file-or-directory> [options]

  --env <name>        environment from http-client.env.json
  --bail              stop at the first failure
  --reporter <kind>   pretty (default) or json
  --timeout <ms>      per-request timeout, default 60000
`)
  process.exit(argv.length ? 0 : 1)
}

const target = path.resolve(argv[0])
const options = {
  env: valueOf('--env') ?? null,
  bail: argv.includes('--bail'),
  reporter: valueOf('--reporter') ?? 'pretty',
  timeout: Number(valueOf('--timeout') ?? 60_000),
}

function valueOf(flag) {
  const at = argv.indexOf(flag)
  return at === -1 ? undefined : argv[at + 1]
}

/* ---------------- build the engine ---------------- */

/**
 * The engine is TypeScript, and this runs under plain node. Bundling it to a
 * temp directory with esbuild — which is already present as a Vite dependency
 * — is the smallest way to run the real modules rather than a reimplementation.
 */
const buildDir = path.join(os.tmpdir(), 'nova-api-cli')
await fs.mkdir(buildDir, { recursive: true })
await fs.symlink(path.join(REPO, 'node_modules'), path.join(buildDir, 'node_modules'), 'dir').catch(
  (err) => {
    if (err.code !== 'EEXIST') throw err
  },
)

async function bundle(source, name) {
  await exec(
    'npx',
    [
      'esbuild',
      source,
      '--bundle',
      '--format=esm',
      '--platform=node',
      // Left external for the same reason the app leaves them external: each
      // resolves parts of itself at runtime.
      '--external:@grpc/grpc-js',
      '--external:protobufjs',
      '--external:js-yaml',
      '--alias:electron=./tests/stubs/electron.mjs',
      `--outfile=${path.join(buildDir, name)}`,
      '--log-level=error',
    ],
    { cwd: REPO },
  )
  return import(pathToFileURL(path.join(buildDir, name)).href)
}

const { runHttpFile } = await bundle('electron/lib/httpRunner.ts', 'runner.js')
const { CookieJar } = await bundle('electron/lib/cookieJar.ts', 'jar.js')

/* ---------------- collect the files ---------------- */

const stat = await fs.stat(target).catch(() => null)
if (!stat) {
  console.error(`No such file or directory: ${target}`)
  process.exit(1)
}

const files = stat.isDirectory() ? await collect(target) : [target]
if (!files.length) {
  console.error(`No .http or .rest files under ${target}`)
  process.exit(1)
}

async function collect(dir) {
  const found = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await collect(full)))
    else if (/\.(http|rest)$/i.test(entry.name)) found.push(full)
  }
  return found.sort()
}

/* ---------------- run ---------------- */

// One jar for the whole run, so a login in the first file is still a session
// in the third — the same thing the IDE does per project.
const jar = new CookieJar()
await jar.open(path.join(buildDir, 'state'))

const results = []
let failed = 0

for (const file of files) {
  const environment = options.env ? await loadEnvironment(file, options.env) : {}

  const result = await runHttpFile(file, {
    environment,
    bail: options.bail,
    context: {
      jar,
      baseDir: path.dirname(file),
      defaultTimeoutMs: options.timeout,
      maxBodyBytes: 8 * 1024 * 1024,
    },
  })

  results.push(result)
  failed += result.failed + result.steps.filter((step) => step.error).length
  if (options.reporter === 'pretty') report(result)
  if (options.bail && failed) break
}

await jar.flush()

if (options.reporter === 'json') {
  console.log(JSON.stringify({ files: results, failed }, null, 2))
} else {
  const passed = results.reduce((sum, result) => sum + result.passed, 0)
  const duration = results.reduce((sum, result) => sum + result.durationMs, 0)
  console.log(
    `\n${passed} passed, ${failed} failed across ${files.length} file${files.length === 1 ? '' : 's'} in ${(duration / 1000).toFixed(2)}s`,
  )
}

process.exit(failed ? 1 : 0)

/* ---------------- output ---------------- */

function report(result) {
  console.log(`\n── ${displayPath(result.file)} ──`)
  if (result.error) {
    console.log(`  ERROR  ${result.error}`)
    return
  }

  for (const step of result.steps) {
    const row = step.dataRow === undefined ? '' : ` [row ${step.dataRow + 1}]`

    if (step.error) {
      console.log(`  ERROR  ${step.name}${row} — ${step.error}`)
    } else if (!step.tests.length) {
      // A request with no assertions is not a pass; saying so keeps a suite
      // from looking greener than it is.
      console.log(`  ----   ${step.name}${row} — ${step.status} (no assertions)`)
    }

    for (const test of step.tests) {
      console.log(`  ${test.passed ? 'PASS' : 'FAIL'}   ${step.name}${row} › ${test.name}`)
      if (!test.passed && test.message) console.log(`         ${test.message}`)
    }

    for (const line of step.logs) console.log(`         · ${line}`)
  }
}

/**
 * A relative path when the file is under the working directory, absolute when
 * it is not — a header of `../../../../private/tmp/...` is worse than the real
 * path it was trying to shorten.
 */
function displayPath(file) {
  const relative = path.relative(process.cwd(), file)
  return relative.startsWith('..') ? file : relative
}

/** The same lookup the IDE does: walk up from the file to the project root. */
async function loadEnvironment(file, name) {
  let dir = path.dirname(file)
  const merged = {}
  let found = false

  for (let depth = 0; depth < 12; depth++) {
    for (const candidate of ['http-client.env.json', 'http-client.private.env.json']) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, candidate), 'utf8'))
        found = true
        for (const [envName, values] of Object.entries(raw)) {
          merged[envName] = { ...(merged[envName] ?? {}), ...values }
        }
      } catch {
        // keep looking
      }
    }
    if (found) break
    if (dir === path.dirname(dir)) break
    dir = path.dirname(dir)
  }

  if (found && !merged[name]) {
    console.error(`No environment named "${name}". Found: ${Object.keys(merged).join(', ') || 'none'}`)
    process.exit(1)
  }
  return merged[name] ?? {}
}
