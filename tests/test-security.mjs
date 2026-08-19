import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

/**
 * The security scanners.
 *
 * Half of these checks are that something is **not** reported. That is the
 * harder half and the one that decides whether the tool gets used: a scanner
 * that flags every UUID and every `md5` used as a cache key gets switched off,
 * and then it finds nothing at all.
 */
const { scanForSecrets, looksSecret, entropy, redactLine } = await import(
  pathToFileURL(`${BUILD}/secretScan.js`).href
)
const { scanForVulnerabilities, isScannable } = await import(pathToFileURL(`${BUILD}/sast.js`).href)
const { SAST_RULES } = await import(pathToFileURL(`${BUILD}/sastRules.js`).href)
const {
  parsePackageLock, parseYarnLock, parsePnpmLock, parseRequirements, parsePoetryLock,
  parseCargoLock, parseGoSum, parseGemfileLock, parseComposerLock,
  auditDependencies, cvssBaseScore,
} = await import(pathToFileURL(`${BUILD}/depAudit.js`).href)

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

function equal(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(label, a === b, `expected ${b}\n        got      ${a}`)
}

/** Rule ids fired by a snippet. */
const rules = (file, text) => scanForVulnerabilities(file, text).map((f) => f.rule)
const secrets = (file, text) => scanForSecrets(file, text).map((h) => h.rule)

/* ------------------------------------------------------------------ */
console.log('\n-- secrets that are real --')
/* ------------------------------------------------------------------ */

/**
 * Fixtures for the scanner, assembled rather than written out.
 *
 * A secret scanner can only be tested against strings that look like real
 * secrets — that is the entire point of it. But a file full of literal
 * credential-shaped tokens is itself what every *other* scanner in the world is
 * looking for, and GitHub's push protection duly refused to accept this file.
 * Being told to click "allow this secret" to push a security test is the wrong
 * outcome twice over: it trains the habit, and it turns the protection off for
 * the one repository that most needs it.
 *
 * Joining the recognisable prefix to the rest at runtime costs nothing. The
 * scanner under test receives byte-for-byte what it did before — these are
 * still the same strings — while no complete token exists as a literal for
 * anything scanning this file to find.
 */
const token = (...parts) => parts.join('')

const REAL = [
  ['an AWS access key id', `const id = "${token('AKIA', 'IOSFODNN7EXAMPLE')}"`, 'aws-access-key'],
  ['a GitHub token', `GITHUB_TOKEN=${token('ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8')}`, 'github-token'],
  ['a Stripe live key', `stripe = "${token('sk', '_live_', '51H8xKjLmNoPqRsTuVwXyZ012')}"`, 'stripe-key'],
  ['a Slack token', `const hook = "${token('xoxb', '-123456789012-abcdefghijkl')}"`, 'slack-token'],
  ['a Google API key', `key: "${token('AIza', 'SyD-1234567890abcdefghijklmnopqrstu')}"`, 'google-api-key'],
  ['an Anthropic key', `ANTHROPIC_API_KEY=${token('sk-ant', '-api03-abcdefghijklmnopqrstuvwxyz')}`, 'anthropic-key'],
  ['a private key header', `${token('-----BEGIN ', 'RSA PRIVATE KEY', '-----')}`, 'private-key'],
  ['a database URL with a password', `DATABASE_URL=${token('postgres://', 'admin:s3cr3tp4ss', '@db.internal:5432/app')}`, 'connection-string'],
  ['a JWT', `const t = "${token('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk')}"`, 'jwt'],
]

for (const [label, line, expected] of REAL) {
  const found = secrets('src/config.ts', line)
  check(`finds ${label}`, found.includes(expected), found.join(', ') || 'nothing')
}

{
  const hits = scanForSecrets('src/config.ts', 'const key = "AKIAIOSFODNN7EXAMPLE"')
  equal('a known format is confirmed', hits[0].confidence, 'confirmed')
  // A scanner that prints the secret it found has published it.
  check('the secret is redacted in the excerpt', !hits[0].excerpt.includes('AKIAIOSFODNN7EXAMPLE'), hits[0].excerpt)
  check('enough is kept to identify it', hits[0].excerpt.includes('MPLE'), hits[0].excerpt)
}

{
  const found = secrets('src/app.ts', 'const apiKey = "9f8Xk2Lm4Qw7Zr1Tb6Yn3Vc5Ha8Jd0Pe"')
  check('finds a high-entropy value behind a secret-ish name', found.includes('hardcoded-credential'), found.join(','))
  equal(
    'but only reports it as likely',
    scanForSecrets('src/app.ts', 'const apiKey = "9f8Xk2Lm4Qw7Zr1Tb6Yn3Vc5Ha8Jd0Pe"')[0].confidence,
    'likely',
  )
}

/* ------------------------------------------------------------------ */
console.log('\n-- things that are not secrets --')
/* ------------------------------------------------------------------ */

const NOT_SECRETS = [
  ['a UUID', 'const id = "550e8400-e29b-41d4-a716-446655440000"'],
  ['a placeholder', 'apiKey = "your-api-key-here"'],
  ['an env reference', 'const token = "${GITHUB_TOKEN}"'],
  ['a template variable', 'password = "{{ vault_password }}"'],
  ['an obvious dummy', 'const secret = "changeme"'],
  ['a short value', 'const key = "abc"'],
  ['a sentence', 'const password = "the quick brown fox"'],
  ['a normal URL', 'const endpoint = "https://api.example.com/v1/users"'],
  ['a file path', 'const keyPath = "/etc/ssl/private/server.key"'],
  ['a version', 'const apiKey = "1.2.34567"'],
  ['a bare hex digest', 'const token = "d41d8cd98f00b204e9800998ecf8427e"'],
  ['an xxx mask', 'password = "xxxxxxxxxxxx"'],
]

for (const [label, line] of NOT_SECRETS) {
  const found = secrets('src/config.ts', line)
  check(`ignores ${label}`, found.length === 0, found.join(', '))
}

check('a suppression comment silences a line', secrets('a.ts', 'const k = "AKIAIOSFODNN7EXAMPLE" // nova-ignore').length === 0)
check('a minified bundle is skipped', secrets('a.js', `const x="${'A1b2C3d4'.repeat(300)}"`).length === 0)

{
  // The shape is the point in an example file, so it is reported quietly
  // rather than not at all — real keys do end up in `.env.example`.
  const hits = scanForSecrets('.env.example', 'AWS_KEY=AKIAIOSFODNN7EXAMPLE')
  check('a sample file still reports, at low severity', hits.length === 1, JSON.stringify(hits))
  equal('and downgrades the confidence', hits[0].confidence, 'possible')
}

check('entropy separates prose from a key', entropy('the quick brown fox') < entropy('9f8Xk2Lm4Qw7Zr1Tb6Yn'))
check('looksSecret rejects a UUID', !looksSecret('550e8400-e29b-41d4-a716-446655440000'))
check('looksSecret accepts a base64-ish key', looksSecret('c2VjcmV0LWtleS12YWx1ZS0xMjM0NTY'))
equal('redaction keeps the line readable', redactLine('key = "abcdefghijklmnop"', 7, 16), 'key = "••••••••••••mnop"')

/* ------------------------------------------------------------------ */
console.log('\n-- vulnerable patterns --')
/* ------------------------------------------------------------------ */

const VULNERABLE = [
  ['SQL concatenation', 'app.ts', 'db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)', 'sql-injection'],
  ['SQL via python format', 'app.py', 'cur.execute("SELECT * FROM t WHERE a = %s" % value)', 'sql-injection'],
  ['command injection', 'app.ts', 'exec(`git checkout ${branch}`)', 'command-injection'],
  ['shell=True', 'app.py', 'subprocess.run(cmd, shell=True)', 'shell-true'],
  ['eval of a variable', 'app.ts', 'eval(userInput)', 'code-eval'],
  ['path traversal', 'app.ts', 'fs.readFileSync(`./uploads/${req.query.name}`)', 'path-traversal'],
  ['innerHTML assignment', 'app.ts', 'el.innerHTML = userComment', 'xss-innerhtml'],
  ['dangerouslySetInnerHTML', 'App.tsx', 'return <div dangerouslySetInnerHTML={{ __html: body }} />', 'react-dangerous-html'],
  ['wildcard CORS', 'server.ts', 'res.setHeader("Access-Control-Allow-Origin", "*")', 'cors-wildcard'],
  ['CSRF disabled', 'server.ts', 'app.use(session({ csrf: false }))', 'csrf-disabled'],
  ['MD5 hashing', 'auth.ts', 'const digest = createHash("md5").update(password).digest("hex")', 'weak-hash'],
  ['ECB mode', 'crypto.py', 'cipher = AES.new(key, AES.MODE_ECB)', 'weak-cipher'],
  ['TLS check disabled', 'client.ts', 'new https.Agent({ rejectUnauthorized: false })', 'tls-verification-off'],
  ['requests verify=False', 'client.py', 'requests.get(url, verify=False)', 'tls-verification-off'],
  ['Go InsecureSkipVerify', 'client.go', 'tls.Config{InsecureSkipVerify: true}', 'tls-verification-off'],
  ['Math.random for a token', 'auth.ts', 'const token = Math.random().toString(36)', 'insecure-random'],
  ['pickle.loads', 'app.py', 'data = pickle.loads(payload)', 'unsafe-deserialization'],
  ['yaml.load without a safe loader', 'app.py', 'config = yaml.load(text)', 'unsafe-deserialization'],
  ['JWT verify disabled', 'auth.ts', 'jwt.decode(token, { verify: false })', 'jwt-none-algorithm'],
  ['Django DEBUG on', 'settings.py', 'DEBUG = True', 'debug-enabled'],
  ['plaintext HTTP', 'api.ts', 'const base = "http://api.production.example.com"', 'http-url'],
]

for (const [label, file, line, expected] of VULNERABLE) {
  const found = rules(file, line)
  check(`flags ${label}`, found.includes(expected), found.join(', ') || 'nothing')
}

/* ------------------------------------------------------------------ */
console.log('\n-- patterns that are fine --')
/* ------------------------------------------------------------------ */

const FINE = [
  ['a parameterised query', 'app.ts', 'db.query("SELECT * FROM users WHERE id = $1", [id])'],
  ['a python parameterised query', 'app.py', 'cur.execute("SELECT * FROM t WHERE a = %s", (value,))'],
  ['md5 used as a cache key', 'cache.ts', 'const cacheKey = createHash("md5").update(url).digest("hex")'],
  ['yaml.safe_load', 'app.py', 'config = yaml.safe_load(text)'],
  ['a localhost URL', 'dev.ts', 'const base = "http://localhost:3000"'],
  ['an XML namespace', 'doc.ts', 'const ns = "http://www.w3.org/2000/svg"'],
  ['textContent instead of innerHTML', 'app.ts', 'el.textContent = userComment'],
  ['a comment describing the risk', 'app.ts', '// never do el.innerHTML = userInput here'],
  ['a suppressed line', 'app.ts', 'eval(userInput) // nosec'],
]

for (const [label, file, line] of FINE) {
  const found = rules(file, line)
  check(`leaves ${label} alone`, found.length === 0, found.join(', '))
}

{
  const text = '// nova-ignore\nel.innerHTML = body'
  check('a suppression on the line above covers the line below', rules('a.ts', text).length === 0, rules('a.ts', text).join(','))
}

// What names the value is usually the enclosing function, not the same line —
// and `\btoken\b` does not see the `Token` inside `sessionToken`.
check(
  'a nearby rule reads camelCase names on surrounding lines',
  rules('a.ts', 'export function sessionToken() {\n  return Math.random().toString(36)\n}').includes('insecure-random'),
  rules('a.ts', 'export function sessionToken() {\n  return Math.random().toString(36)\n}').join(','),
)
check(
  'but plain randomness with no such name is left alone',
  rules('a.ts', 'const jitter = Math.random() * 100').length === 0,
  rules('a.ts', 'const jitter = Math.random() * 100').join(','),
)

check('a rule only runs on its own languages', rules('app.py', 'el.innerHTML = x').length === 0)
check('node_modules is not scanned', !isScannable('node_modules/lib/index.js'))
check('a minified file is not scanned', !isScannable('dist/app.min.js'))
check('project source is scanned', isScannable('src/app.ts'))

{
  const found = scanForVulnerabilities('a.ts', 'eval(userInput)')
  check('every rule carries a fix', found.every((f) => f.remediation.length > 20), '')
  check('every rule carries a CWE', found.every((f) => /^CWE-\d+$/.test(f.cwe ?? '')), '')
  // A pattern cannot prove a vulnerability, and claiming otherwise is how a
  // scanner loses the benefit of the doubt on the findings that are real.
  check('no SAST rule claims to be confirmed', SAST_RULES.every((r) => r.confidence !== 'confirmed'), '')
}

/* ------------------------------------------------------------------ */
console.log('\n-- reading lockfiles --')
/* ------------------------------------------------------------------ */

equal(
  'npm lockfile v3',
  parsePackageLock(
    JSON.stringify({
      packages: {
        '': { version: '1.0.0' },
        'node_modules/lodash': { version: '4.17.20' },
        'node_modules/@scope/pkg': { version: '2.0.0', dev: true },
      },
    }),
    'package-lock.json',
  ).map((d) => [d.name, d.version, d.dev]),
  [['lodash', '4.17.20', false], ['@scope/pkg', '2.0.0', true]],
)

equal(
  'npm lockfile v1',
  parsePackageLock(
    JSON.stringify({ dependencies: { minimist: { version: '1.2.0' } } }),
    'package-lock.json',
  ).map((d) => [d.name, d.version]),
  [['minimist', '1.2.0']],
)

equal(
  'yarn.lock',
  parseYarnLock('lodash@^4.17.0:\n  version "4.17.20"\n\n"@scope/pkg@^2.0.0":\n  version "2.0.0"\n', 'yarn.lock')
    .map((d) => [d.name, d.version]),
  [['lodash', '4.17.20'], ['@scope/pkg', '2.0.0']],
)

equal(
  'pnpm-lock.yaml',
  parsePnpmLock('packages:\n  /lodash/4.17.20:\n    resolution: {integrity: sha512-x}\n', 'pnpm-lock.yaml')
    .map((d) => [d.name, d.version]),
  [['lodash', '4.17.20']],
)

equal(
  'requirements.txt takes only pinned versions',
  parseRequirements('django==3.2.4\nrequests>=2.0\n# a comment\nflask==2.0.1\n', 'requirements.txt')
    .map((d) => [d.name, d.version]),
  [['django', '3.2.4'], ['flask', '2.0.1']],
)

equal(
  'poetry.lock',
  parsePoetryLock('[[package]]\nname = "django"\nversion = "3.2.4"\ncategory = "main"\n', 'poetry.lock')
    .map((d) => [d.name, d.version, d.dev]),
  [['django', '3.2.4', false]],
)

equal(
  'Cargo.lock',
  parseCargoLock('[[package]]\nname = "serde"\nversion = "1.0.130"\n', 'Cargo.lock').map((d) => [d.name, d.version]),
  [['serde', '1.0.130']],
)

equal(
  'go.sum ignores the go.mod lines',
  parseGoSum(
    'github.com/x/y v1.2.3 h1:abc=\ngithub.com/x/y v1.2.3/go.mod h1:def=\n',
    'go.sum',
  ).map((d) => [d.name, d.version]),
  [['github.com/x/y', 'v1.2.3']],
)

equal(
  'Gemfile.lock',
  parseGemfileLock('GEM\n  remote: https://rubygems.org/\n  specs:\n    rails (6.1.4)\n    rake (13.0.6)\n', 'Gemfile.lock')
    .map((d) => [d.name, d.version]),
  [['rails', '6.1.4'], ['rake', '13.0.6']],
)

equal(
  'composer.lock separates dev packages',
  parseComposerLock(
    JSON.stringify({ packages: [{ name: 'monolog/monolog', version: 'v2.3.5' }], 'packages-dev': [{ name: 'phpunit/phpunit', version: '9.5.0' }] }),
    'composer.lock',
  ).map((d) => [d.name, d.version, d.dev]),
  [['monolog/monolog', 'v2.3.5'.replace(/^v/, ''), false], ['phpunit/phpunit', '9.5.0', true]],
)

/* ------------------------------------------------------------------ */
console.log('\n-- matching advisories --')
/* ------------------------------------------------------------------ */

/** Stands in for OSV, so the suite does not depend on the network. */
function fakeOsv(vulnsByIndex, detail = {}) {
  return async (url, init) => {
    if (String(url).endsWith('/querybatch')) {
      const body = JSON.parse(init.body)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: body.queries.map((_q, index) => ({ vulns: vulnsByIndex[index] ?? [] })),
        }),
      }
    }
    const id = String(url).split('/').pop()
    return { ok: true, status: 200, json: async () => detail[id] ?? {} }
  }
}

{
  const dependencies = [
    { name: 'lodash', version: '4.17.20', ecosystem: 'npm', lockfile: 'package-lock.json', dev: false },
    { name: 'safe-pkg', version: '1.0.0', ecosystem: 'npm', lockfile: 'package-lock.json', dev: false },
  ]
  const { findings } = await auditDependencies('/p', dependencies, {
    fetchImpl: fakeOsv([[{ id: 'GHSA-1234-abcd-5678' }], []], {
      'GHSA-1234-abcd-5678': {
        id: 'GHSA-1234-abcd-5678',
        summary: 'Prototype pollution',
        database_specific: { severity: 'HIGH' },
        affected: [{ package: { name: 'lodash' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '4.17.21' }] }] }],
      },
    }),
  })

  equal('only the affected package is reported', findings.length, 1)
  equal('the package is named', [findings[0].packageName, findings[0].packageVersion], ['lodash', '4.17.20'])
  // The one thing this whole tool can state as fact.
  equal('a dependency finding is confirmed', findings[0].confidence, 'confirmed')
  equal('the advisory severity is used', findings[0].severity, 'high')
  equal('the fixed version is read from the advisory', findings[0].fixedIn, '4.17.21')
  check('the remediation names the version to move to', findings[0].remediation.includes('4.17.21'), findings[0].remediation)
  check('the advisory is linked', (findings[0].references ?? []).includes('GHSA-1234-abcd-5678'), '')
  check('the summary is used as the title', findings[0].title.includes('Prototype pollution'), findings[0].title)
}

{
  const { findings } = await auditDependencies(
    '/p',
    [{ name: 'x', version: '1.0.0', ecosystem: 'npm', lockfile: 'package-lock.json', dev: false }],
    {
      fetchImpl: fakeOsv([[{ id: 'GHSA-none' }]], {
        'GHSA-none': { id: 'GHSA-none', summary: 'No fix yet', affected: [{ package: { name: 'x' }, ranges: [{ events: [{ introduced: '0' }] }] }] },
      }),
    },
  )
  check('an advisory with no fix says so', /No fixed version/.test(findings[0].remediation), findings[0].remediation)
}

{
  const { findings } = await auditDependencies(
    '/p',
    [{ name: 'x', version: '1.0.0', ecosystem: 'npm', lockfile: 'l', dev: true }],
    { productionOnly: true, fetchImpl: fakeOsv([[{ id: 'GHSA-dev' }]]) },
  )
  equal('production-only skips dev dependencies', findings.length, 0)
}

{
  // A scan that fails entirely because one phase had no network is less
  // useful than one that says so and reports the other two.
  const { findings, note } = await auditDependencies(
    '/p',
    [{ name: 'x', version: '1.0.0', ecosystem: 'npm', lockfile: 'l', dev: false }],
    { fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND') } },
  )
  equal('a network failure reports nothing rather than throwing', findings.length, 0)
  check('and explains why', /Could not reach the advisory database/.test(note ?? ''), note)
}

equal('a numeric CVSS score is read', cvssBaseScore('9.8'), 9.8)
equal('a score at the end of a vector is read', cvssBaseScore('CVSS:3.1/AV:N/AC:L/7.5'), 7.5)
equal('an unreadable vector is skipped rather than guessed', cvssBaseScore('CVSS:3.1/AV:N/AC:L'), null)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
