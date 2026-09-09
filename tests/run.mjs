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
import path from 'node:path'
import { mkdir, symlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import { BUILD, REPO, TMP } from './env.mjs'

const exec = promisify(execFile)

/**
 * npm installs its tools as `.cmd` shims on Windows, and `execFile` neither
 * finds `npx` without an extension nor is allowed to run the shim once it does
 * — the same wall the app itself hit, which is why this ran nowhere on Windows.
 * esbuild ships a real executable next to the shim, so use that directly.
 */
const ESBUILD =
  process.platform === 'win32'
    ? path.join(REPO, 'node_modules', '@esbuild', 'win32-x64', 'esbuild.exe')
    : path.join(REPO, 'node_modules', '.bin', 'esbuild')

const BUNDLES = [
  ['electron/lib/parseSymbols.ts', 'parseSymbols'],
  ['electron/lib/projectIndex.ts', 'projectIndex'],
  ['electron/lib/testFrameworks.ts', 'testFrameworks'],
  ['electron/lib/debugSession.ts', 'debugSession'],
  ['electron/lib/lspManager.ts', 'lspManager'],
  ['src/lib/applyEdits.ts', 'applyEdits'],
  ['src/lib/refactor/index.ts', 'refactor'],
  ['src/lib/explain.ts', 'explain'],
  ['src/lib/tutorial.ts', 'tutorial'],
  ['electron/lib/opencode.ts', 'opencode'],
  ['src/lib/format/format.ts', 'format'],
  ['src/lib/format/imports.ts', 'imports'],
  ['electron/lib/editorConfig.ts', 'editorConfig'],
  ['electron/lib/runConfigs.ts', 'runConfigs'],
  ['src/lib/inspections/batch.ts', 'inspections'],
  ['src/lib/postfix.ts', 'postfix'],
  ['src/lib/sqlTools.ts', 'sqlTools'],
  ['src/lib/codeDiagrams.ts', 'codeDiagrams'],
  ['src/lib/semanticClassify.ts', 'semanticClassify'],
  ['electron/lib/httpFile.ts', 'httpFile'],
  ['electron/lib/httpAuth.ts', 'httpAuth'],
  ['electron/lib/cookieJar.ts', 'cookieJar'],
  ['electron/lib/httpClient.ts', 'httpClient'],
  ['electron/lib/httpStream.ts', 'httpStream'],
  ['electron/lib/graphql.ts', 'graphql'],
  ['electron/lib/grpcClient.ts', 'grpcClient'],
  ['electron/lib/httpScript.ts', 'httpScript'],
  ['electron/lib/httpRunner.ts', 'httpRunner'],
  ['electron/lib/jsonSchema.ts', 'jsonSchema'],
  ['electron/lib/openapi.ts', 'openapi'],
  ['electron/lib/mockServer.ts', 'mockServer'],
  ['electron/lib/visualDiff.ts', 'visualDiff'],
  ['src/lib/e2eRecorder.ts', 'e2eRecorder'],
  ['src/lib/e2eCodegen.ts', 'e2eCodegen'],
  ['src/lib/autoRun.ts', 'autoRun'],
  ['src/lib/chatMessages.ts', 'chatMessages'],
  ['src/lib/messageQueue.ts', 'messageQueue'],
  ['electron/lib/reviewBridge.ts', 'reviewBridge'],
  ['electron/lib/secretScan.ts', 'secretScan'],
  ['electron/lib/sast.ts', 'sast'],
  ['electron/lib/sastRules.ts', 'sastRules'],
  ['electron/lib/depAudit.ts', 'depAudit'],
  // The boundary modules: paths that arrive from a repository, stores that
  // hold the user's work, and the framing that reads a language server. Every
  // one of these was untested, and every one of them had a bug.
  ['electron/lib/workspacePath.ts', 'workspacePath'],
  ['electron/lib/fileStore.ts', 'fileStore'],
  ['electron/lib/rpcFraming.ts', 'rpcFraming'],
  ['electron/lib/declarations.ts', 'declarations'],
  ['electron/lib/env.ts', 'env'],
  ['electron/lib/spawnTool.ts', 'spawnTool'],
  ['electron/lib/localHistory.ts', 'localHistory'],
  ['electron/lib/geminiStream.ts', 'geminiStream'],
  ['src/lib/fileIcons.tsx', 'fileIcons'],
  ['src/lib/panelLayout.ts', 'panelLayout'],
]

const OFFLINE = [
  'test-parse',
  'test-edits',
  'test-frameworks',
  'test-index',
  'test-refactor',
  'test-explain',
  'test-tutorial',
  'test-opencode',
  'test-format',
  'test-semantic',
  'test-http',
  'test-grpc',
  'test-apitest',
  'test-e2e',
  'test-autorun',
  'test-chatstate',
  'test-queue',
  'test-mcp-review',
  'test-review-bridge',
  'test-security',
  'test-hardening',
  'test-providers',
  'test-icons',
  'test-spawn',
  'test-layout',
  'test-tools',
]
const TOOLS = ['test-lsp', 'test-hier', 'test-dap-py']

const only = process.argv[2]
const suites = only === 'offline' ? OFFLINE : only === 'tools' ? TOOLS : [...OFFLINE, ...TOOLS]

await mkdir(BUILD, { recursive: true })

// The bundles live outside the repo, so a module left external — grpc-js and
// protobufjs — has nowhere to resolve from. Linking the real tree in is enough
// for Node's resolver to walk up and find it.
await symlink(path.join(REPO, 'node_modules'), path.join(BUILD, 'node_modules'), 'dir').catch(
  (err) => {
    if (err.code !== 'EEXIST') throw err
  },
)

process.stdout.write(`building ${BUNDLES.length} modules → ${BUILD}\n`)
for (const [src, out] of BUNDLES) {
  await exec(
    ESBUILD,
    [
      src,
      '--bundle',
      '--format=esm',
      '--platform=node',
      // `electron` resolves to the *binary path*, not the API, outside a running
      // Electron process — bundling it in crashes on a dynamic require. The stub
      // supplies the little of `app` the main-process modules actually use.
      '--alias:electron=./tests/stubs/electron.mjs',
      // Both resolve parts of themselves at runtime, so they are required from
      // node_modules rather than inlined — the same treatment the app gives
      // them in vite.config.ts.
      '--external:@grpc/grpc-js',
      '--external:protobufjs',
      '--external:js-yaml',
      `--outfile=${BUILD}/${out}.js`,
      '--log-level=error',
    ],
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
