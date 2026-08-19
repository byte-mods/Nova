/**
 * The security scan, through the running IDE.
 *
 * The fixture below is deliberately vulnerable — it exists to be found. The
 * credentials in it are the published example values from each provider's own
 * documentation, so nothing here is a live secret.
 *
 * Start the app first:  bash tests/restart-app.sh
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'

const PROJECT = path.join(TMP, 'security-demo')

await fs.rm(PROJECT, { recursive: true, force: true })
await fs.mkdir(path.join(PROJECT, 'src'), { recursive: true })

await fs.writeFile(
  path.join(PROJECT, 'package.json'),
  JSON.stringify({ name: 'security-demo', version: '1.0.0' }, null, 2),
)

// A lockfile with a package that has a long-published advisory, so the
// dependency phase has something real to match.
await fs.writeFile(
  path.join(PROJECT, 'package-lock.json'),
  JSON.stringify(
    {
      name: 'security-demo',
      lockfileVersion: 3,
      packages: {
        '': { version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.11' },
        'node_modules/minimist': { version: '1.2.0' },
      },
    },
    null,
    2,
  ),
)

await fs.writeFile(
  path.join(PROJECT, 'src', 'unsafe.ts'),
  `import { createHash } from 'node:crypto'
import https from 'node:https'

// AWS's own published example key id, not a live credential.
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE'

export function findUser(db: any, id: string) {
  return db.query(\`SELECT * FROM users WHERE id = \${id}\`)
}

export function render(el: HTMLElement, comment: string) {
  el.innerHTML = comment
}

export function digest(password: string) {
  return createHash('md5').update(password).digest('hex')
}

export const agent = new https.Agent({ rejectUnauthorized: false })

export function sessionToken() {
  return Math.random().toString(36).slice(2)
}
`,
)

// A file that must produce nothing: the same shapes, used correctly.
await fs.writeFile(
  path.join(PROJECT, 'src', 'safe.ts'),
  `import { createHash, randomBytes } from 'node:crypto'

export function findUser(db: any, id: string) {
  return db.query('SELECT * FROM users WHERE id = $1', [id])
}

export function render(el: HTMLElement, comment: string) {
  el.textContent = comment
}

export const cacheKey = (url: string) => createHash('md5').update(url).digest('hex')
export const sessionToken = () => randomBytes(32).toString('hex')
export const requestId = '550e8400-e29b-41d4-a716-446655440000'
export const local = 'http://localhost:3000'
`,
)

const cdp = await connect()

let pass = 0
let fail = 0

function check(label, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`)
  }
}

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ sidebarVisible: true, sidebarView: 'explorer' })
  await s.getState().openProject(${JSON.stringify(PROJECT)})
  return true
`)
await cdp.waitFor(`document.querySelectorAll('.tree-row').length > 0`, { label: 'file tree' })

/* ------------------------------------------------------------------ */
console.log('\n-- scanning over the bridge --')
/* ------------------------------------------------------------------ */

const result = await cdp.evaluate(
  `
  const progress = []
  const off = window.nova.security.onProgress((p) => progress.push(p.phase))
  const r = await window.nova.security.scan(${JSON.stringify(PROJECT)}, {
    sast: true, secrets: true, dependencies: true,
  })
  off()
  return { r, phases: [...new Set(progress)] }
`,
  120000,
)

const findings = result.r.findings
const has = (rule) => findings.some((f) => f.rule === rule)
// `endsWith` would match `unsafe.ts` for `safe.ts`, which is exactly the kind
// of near-miss that makes a test agree with a bug.
const inFile = (name) => findings.filter((f) => f.relative.split('/').pop() === name)

check('the scan completes', Array.isArray(findings), JSON.stringify(result.r).slice(0, 200))
check('progress is reported as it goes', result.phases.includes('done'), JSON.stringify(result.phases))
check('files were scanned', result.r.filesScanned >= 2, String(result.r.filesScanned))

console.log(`\n        ${findings.length} findings across ${result.r.filesScanned} files`)
for (const f of findings.slice(0, 14)) {
  console.log(`        ${f.severity.padEnd(8)} ${f.confidence.padEnd(9)} ${f.rule.padEnd(24)} ${f.relative}:${f.line}`)
}

/* ------------------------------------------------------------------ */
console.log('\n-- what it found --')
/* ------------------------------------------------------------------ */

check('the SQL concatenation', has('sql-injection'), '')
check('the innerHTML assignment', has('xss-innerhtml'), '')
check('the MD5 password hash', has('weak-hash'), '')
check('the disabled TLS check', has('tls-verification-off'), '')
check('the predictable token', has('insecure-random'), '')
check('the AWS key', has('aws-access-key'), '')

{
  const aws = findings.find((f) => f.rule === 'aws-access-key')
  check('the key is redacted in the finding', !aws?.excerpt.includes('AKIAIOSFODNN7EXAMPLE'), aws?.excerpt)
  check('it is reported as confirmed', aws?.confidence === 'confirmed', aws?.confidence)
  check('it carries a CWE', aws?.cwe === 'CWE-798', aws?.cwe)
  check('it says what to do', (aws?.remediation ?? '').length > 20, aws?.remediation)
}

// The half that decides whether anyone keeps the tool switched on.
check(
  'the correct file produces nothing',
  inFile('safe.ts').length === 0,
  inFile('safe.ts').map((f) => `${f.rule}:${f.line}`).join(', '),
)

/* ------------------------------------------------------------------ */
console.log('\n-- dependencies --')
/* ------------------------------------------------------------------ */

{
  const vulnerable = findings.filter((f) => f.source === 'dependency')
  const note = result.r.notes.join(' ')

  if (/Could not reach|returned \d/.test(note)) {
    // Offline is a legitimate state, and it must be reported rather than
    // silently producing zero dependency findings.
    check('an unreachable advisory database is reported, not hidden', true, note)
  } else {
    check('the vulnerable package is found', vulnerable.length > 0, note || 'no findings and no note')
    check(
      'a dependency finding is confirmed',
      vulnerable.every((f) => f.confidence === 'confirmed'),
      JSON.stringify(vulnerable.map((f) => f.confidence)),
    )
    check(
      'it links the advisory',
      vulnerable.every((f) => (f.references ?? []).length > 0),
      '',
    )
    check(
      'it names a version to upgrade to',
      vulnerable.some((f) => Boolean(f.fixedIn)),
      JSON.stringify(vulnerable.map((f) => f.fixedIn)),
    )
    console.log(`\n        ${vulnerable.length} vulnerable dependencies`)
    for (const f of vulnerable.slice(0, 6)) {
      console.log(`        ${f.severity.padEnd(8)} ${f.packageName}@${f.packageVersion} → ${f.fixedIn ?? '(no fix)'}  ${f.references?.[0] ?? ''}`)
    }
  }
}

/* ------------------------------------------------------------------ */
console.log('\n-- ordering --')
/* ------------------------------------------------------------------ */

{
  const order = ['critical', 'high', 'medium', 'low', 'info']
  const positions = findings.map((f) => order.indexOf(f.severity))
  check(
    'findings are worst first',
    positions.every((value, index) => index === 0 || positions[index - 1] <= value),
    JSON.stringify(findings.map((f) => f.severity)),
  )
}

/* ------------------------------------------------------------------ */
console.log('\n-- the panel --')
/* ------------------------------------------------------------------ */

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().showPanel('security')
  return true
`)
await cdp.sleep(900)

check('the Security tab exists', await cdp.evaluate(`return document.querySelector('.security-view') !== null`))

{
  const clicked = await cdp.clickText('.security-view button', 'Scan project', { settle: 500 })
  check('the scan action is present', clicked, '')
  await cdp.waitFor(`document.querySelectorAll('.security-finding').length > 0`, {
    label: 'findings',
    timeout: 120000,
  })

  const panel = await cdp.evaluate(`
    const rows = [...document.querySelectorAll('.security-finding')]
    rows[0]?.querySelector('.security-head')?.click()
    await new Promise((r) => setTimeout(r, 250))
    return {
      rows: rows.length,
      pills: [...document.querySelectorAll('.security-pill')].map((p) => p.textContent.trim()),
      confidences: [...document.querySelectorAll('.security-confidence')].map((c) => c.textContent.trim()),
      body: document.querySelector('.security-body')?.textContent ?? '',
    }
  `)

  check('findings are listed', panel.rows > 0, String(panel.rows))
  check('severities are summarised', panel.pills.length > 0, JSON.stringify(panel.pills))
  // A pattern match shown as a fact is how a scanner loses trust.
  check(
    'confidence is spelled out, not implied',
    panel.confidences.some((c) => /confirmed|check it|may be fine/.test(c)),
    JSON.stringify(panel.confidences.slice(0, 5)),
  )
  check('an expanded finding shows its fix', panel.body.includes('Fix'), panel.body.slice(0, 120))
}

console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
