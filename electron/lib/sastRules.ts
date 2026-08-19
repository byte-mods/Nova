/**
 * Static analysis rules for the vulnerability classes that actually recur.
 *
 * These are pattern rules, not a dataflow analysis, and that limit is the most
 * important thing about them. A pattern can see that a query is built by
 * concatenation; it cannot see whether the concatenated value came from a
 * request or from a constant three files away. So every rule here reports at
 * `likely` or `possible`, never `confirmed`, and every message says what to
 * check rather than asserting a vulnerability exists.
 *
 * The alternative — reporting pattern matches as facts — is how a security
 * tool loses its audience. Two hundred findings that are mostly wrong get
 * dismissed wholesale, including the four that were right.
 *
 * Each rule carries its CWE so a finding can be looked up, and a remediation,
 * because a finding with no fix attached is just a complaint.
 */
import type { Confidence, Severity } from '../../shared/security'

export interface SastRule {
  id: string
  title: string
  severity: Severity
  confidence: Confidence
  cwe: string
  /** Extensions this applies to. Empty means every source file. */
  extensions: string[]
  pattern: RegExp
  /** What is wrong. `$1` is replaced with the first capture. */
  detail: string
  remediation: string
  /**
   * Suppresses a match that is plainly fine — a parameterised query, a hash
   * used for a cache key. Keeping this per rule beats one global list, because
   * what counts as innocent is different for each.
   */
  unless?: RegExp
  /**
   * Also satisfied by the few lines around the match, not just the line
   * itself. What makes `Math.random()` a finding is what the value is *for*,
   * and that is usually the name of the enclosing function rather than
   * anything on the same line.
   */
  nearby?: RegExp
}

/** How far `nearby` looks in each direction. */
export const NEARBY_LINES = 3

const JS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']
const PY = ['.py']
const PHP = ['.php']
const JAVA = ['.java', '.kt']
const RUBY = ['.rb']
const GO = ['.go']
const WEB = [...JS, '.html', '.vue', '.svelte']

export const SAST_RULES: SastRule[] = [
  /* ---------------- injection ---------------- */

  {
    id: 'sql-injection',
    title: 'SQL built by string concatenation',
    severity: 'high',
    confidence: 'likely',
    cwe: 'CWE-89',
    extensions: [...JS, ...PY, ...PHP, ...JAVA, ...RUBY, ...GO],
    // A SQL keyword followed by an interpolation or a concatenation.
    pattern:
      /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE|VALUES)\b[^;'"`\n]*(?:\$\{[^}]+\}|["'`]\s*\+\s*\w|%\s*\(?\w|\.format\(|f["'])/i,
    detail: 'A SQL statement is assembled from a variable rather than parameterised.',
    remediation:
      'Use a parameterised query — `?` or `$1` placeholders with the values passed separately. Escaping by hand is not a substitute.',
    // A parameterised call that happens to also concatenate a table name.
    unless: /\?\s*\)|\$\d|:\w+\s*[,)]|execute\([^,]+,\s*[[(]/,
  },
  {
    id: 'command-injection',
    title: 'Shell command built from a variable',
    severity: 'critical',
    confidence: 'likely',
    cwe: 'CWE-78',
    extensions: [...JS, ...PY, ...PHP, ...RUBY],
    pattern:
      /\b(exec|execSync|spawnSync|system|popen|shell_exec|passthru|os\.system|subprocess\.(?:call|run|Popen))\s*\([^)]*(?:\$\{[^}]+\}|["'`]\s*\+\s*\w|%\s*\w|f["'])/,
    detail: 'A shell command is built by interpolating a value into a string.',
    remediation:
      'Pass the command and its arguments as an array, so the shell never parses the value. Where a shell is genuinely needed, allow-list the input.',
  },
  {
    id: 'shell-true',
    title: 'Subprocess run through a shell',
    severity: 'medium',
    confidence: 'possible',
    cwe: 'CWE-78',
    extensions: PY,
    pattern: /subprocess\.(?:call|run|Popen|check_output)\([^)]*shell\s*=\s*True/,
    detail: '`shell=True` makes the whole command string subject to shell parsing.',
    remediation: 'Drop `shell=True` and pass the arguments as a list.',
  },
  {
    id: 'code-eval',
    title: 'Dynamic code execution',
    severity: 'high',
    confidence: 'likely',
    cwe: 'CWE-95',
    extensions: [...JS, ...PY, ...PHP, ...RUBY],
    pattern: /\b(eval|new\s+Function|setTimeout\s*\(\s*["'`]|exec)\s*\(\s*(?!["'`]\s*\))[^)]*\w/,
    detail: 'Code is compiled from a string at runtime.',
    remediation:
      'Replace it with a lookup table, `JSON.parse`, or a real parser. If it must stay, the input has to be a value the program produced, never one it received.',
    unless: /eval\s*\(\s*["'`][^"'`]*["'`]\s*\)/,
  },
  {
    id: 'path-traversal',
    title: 'File path built from a variable',
    severity: 'high',
    confidence: 'possible',
    cwe: 'CWE-22',
    extensions: [...JS, ...PY, ...PHP, ...RUBY, ...GO],
    pattern:
      /\b(readFile|readFileSync|writeFile|writeFileSync|createReadStream|createWriteStream|open|sendFile|file_get_contents|File\.read)\s*\([^)]*(?:\$\{[^}]+\}|["'`]\s*\+\s*\w|\+\s*req\.|os\.path\.join\([^)]*\w)/,
    detail: 'A path is assembled from a value, which may escape the intended directory.',
    remediation:
      'Resolve the path, then check it still starts with the directory you meant. Stripping `..` is not enough — symlinks and encodings get around it.',
  },

  /* ---------------- web ---------------- */

  {
    id: 'xss-innerhtml',
    title: 'Untrusted value written as HTML',
    severity: 'high',
    confidence: 'likely',
    cwe: 'CWE-79',
    extensions: WEB,
    pattern: /\.(innerHTML|outerHTML)\s*=\s*(?!["'`][^"'`]*["'`]\s*[;\n])|\bdocument\.write\s*\(/,
    detail: 'Assigning to `innerHTML` renders whatever the value contains, including script.',
    remediation:
      'Use `textContent` for text. Where markup is genuinely needed, sanitise with a library such as DOMPurify.',
  },
  {
    id: 'react-dangerous-html',
    title: 'dangerouslySetInnerHTML',
    severity: 'high',
    confidence: 'possible',
    cwe: 'CWE-79',
    extensions: JS,
    pattern: /dangerouslySetInnerHTML\s*=\s*\{\{/,
    detail: 'React escapes everything except this, which is why it is named the way it is.',
    remediation: 'Render the value as text, or sanitise the HTML before it gets here.',
  },
  {
    id: 'cors-wildcard',
    title: 'CORS open to every origin',
    severity: 'medium',
    confidence: 'likely',
    cwe: 'CWE-942',
    extensions: [...JS, ...PY, ...PHP, ...GO],
    pattern: /Access-Control-Allow-Origin["'\s:,]+\*|origin\s*:\s*["']\*["']/i,
    detail: 'Any site can read responses from this endpoint.',
    remediation:
      'Name the origins you trust. A wildcard with credentials is refused by browsers anyway, which is usually how this is discovered.',
  },
  {
    id: 'csrf-disabled',
    title: 'CSRF protection turned off',
    severity: 'high',
    confidence: 'likely',
    cwe: 'CWE-352',
    extensions: [...JS, ...PY, ...PHP, ...RUBY],
    pattern: /csrf\s*[:=]\s*(?:false|False|None|null)|@csrf_exempt|skip_before_action\s+:verify_authenticity_token/,
    detail: 'State-changing requests can be made from another site on a user’s behalf.',
    remediation:
      'Re-enable the protection. For an API called by non-browser clients, prefer a token in a header, which is not sent cross-site automatically.',
  },

  /* ---------------- crypto and transport ---------------- */

  {
    id: 'weak-hash',
    title: 'Broken hash function',
    severity: 'medium',
    confidence: 'likely',
    cwe: 'CWE-327',
    extensions: [...JS, ...PY, ...PHP, ...JAVA, ...RUBY, ...GO],
    pattern: /\b(?:createHash\s*\(\s*["'](?:md5|sha1)["']|hashlib\.(?:md5|sha1)\s*\(|MessageDigest\.getInstance\s*\(\s*["'](?:MD5|SHA-?1)["']|md5\s*\()/i,
    detail: 'MD5 and SHA-1 are broken for anything that needs to resist an attacker.',
    remediation:
      'Use SHA-256 for integrity, and bcrypt, scrypt or Argon2 for passwords. A fast hash is the wrong tool for a password whatever its strength.',
    // Non-security uses are legitimate and common.
    unless: /etag|cache[_-]?key|checksum|fingerprint|dedup|bucket|shard/i,
  },
  {
    id: 'weak-cipher',
    title: 'Broken cipher',
    severity: 'high',
    confidence: 'likely',
    cwe: 'CWE-327',
    extensions: [...JS, ...PY, ...PHP, ...JAVA, ...GO],
    pattern: /\b(?:DES|RC4|3DES|Blowfish|createCipher\s*\()|AES\/ECB|MODE_ECB/,
    detail: 'This cipher or mode does not provide the confidentiality it appears to.',
    remediation:
      'Use AES-GCM or ChaCha20-Poly1305 — an authenticated mode, so tampering is detected rather than decrypted.',
  },
  {
    id: 'tls-verification-off',
    title: 'TLS certificate checking disabled',
    severity: 'critical',
    confidence: 'likely',
    cwe: 'CWE-295',
    extensions: [...JS, ...PY, ...PHP, ...GO, ...RUBY],
    pattern:
      /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0)|VERIFY_NONE/,
    detail: 'The connection is encrypted but unauthenticated, so anyone in the path can read it.',
    remediation:
      'Turn verification back on. For a self-signed certificate, add that CA to the trust store rather than disabling the check.',
  },
  {
    id: 'insecure-random',
    title: 'Predictable randomness used for a secret',
    severity: 'medium',
    confidence: 'possible',
    cwe: 'CWE-338',
    extensions: [...JS, ...PY, ...JAVA, ...PHP],
    pattern: /\b(?:Math\.random\s*\(|random\.random\s*\(|mt_rand\s*\(|new\s+Random\s*\(|\brand\s*\(\s*\))/,
    // Only a finding when the value is used for something that must not be
    // guessable; `Math.random()` for a jitter or a demo colour is fine.
    // `id` is deliberately absent: `elementId` and `videoId` are everywhere,
    // and a random DOM id is not a security problem.
    nearby: /\b(?:token|secret|password|passwd|key|nonce|salt|otp|session|csrf|uuid|apikey)\b/i,
    detail: 'A general-purpose random number generator is predictable from its output.',
    remediation:
      'Use `crypto.randomBytes`, `secrets.token_urlsafe`, or `SecureRandom` — a generator meant for values an attacker must not guess.',
  },
  {
    id: 'http-url',
    title: 'Plaintext HTTP endpoint',
    severity: 'low',
    confidence: 'possible',
    cwe: 'CWE-319',
    extensions: [...JS, ...PY, ...PHP, ...JAVA, ...RUBY, ...GO],
    pattern: /["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|example\.|schemas?\.|www\.w3\.org|xmlns)[^"'`\s]+/,
    detail: 'Traffic to this address is readable and modifiable in transit.',
    remediation: 'Use HTTPS. If the service genuinely has no TLS, that is the finding.',
  },

  /* ---------------- deserialization and misc ---------------- */

  {
    id: 'unsafe-deserialization',
    title: 'Unsafe deserialization',
    severity: 'critical',
    confidence: 'likely',
    cwe: 'CWE-502',
    extensions: [...PY, ...PHP, ...RUBY, ...JAVA],
    pattern: /\b(?:pickle\.loads?|yaml\.load\s*\((?![^)]*Safe)|unserialize\s*\(|Marshal\.load|readObject\s*\(|ObjectInputStream)/,
    detail: 'Deserializing untrusted data can execute code during the deserialization itself.',
    remediation:
      'Use a data-only format — JSON, or `yaml.safe_load`. If an object graph is genuinely needed, sign the payload and verify before reading it.',
  },
  {
    id: 'jwt-none-algorithm',
    title: 'JWT signature not verified',
    severity: 'critical',
    confidence: 'likely',
    cwe: 'CWE-347',
    extensions: [...JS, ...PY, ...PHP],
    pattern: /\b(?:jwt\.decode\s*\([^)]*verify\s*[:=]\s*(?:false|False)|algorithms?\s*[:=]\s*\[?\s*["']none["']|decode\s*\([^)]*\{\s*complete)/,
    detail: 'A token is read without checking who signed it, so anyone can mint one.',
    remediation:
      'Verify with an explicit algorithm allow-list. Never accept the algorithm named in the token itself.',
  },
  {
    id: 'debug-enabled',
    title: 'Debug mode enabled',
    severity: 'medium',
    confidence: 'possible',
    cwe: 'CWE-489',
    extensions: [...PY, ...PHP, ...JS, ...RUBY],
    pattern: /\bDEBUG\s*[:=]\s*True\b|app\.run\([^)]*debug\s*=\s*True|display_errors\s*[:=]\s*(?:On|1)/,
    detail: 'Debug mode exposes stack traces, configuration, and sometimes an interactive console.',
    remediation: 'Drive it from an environment variable, defaulting to off.',
  },
  {
    id: 'wildcard-bind',
    title: 'Service bound to every interface',
    severity: 'low',
    confidence: 'possible',
    cwe: 'CWE-668',
    extensions: [...PY, ...JS, ...GO],
    pattern: /["'](?:0\.0\.0\.0|::)["']\s*(?:,|\)|:)|host\s*=\s*["']0\.0\.0\.0["']/,
    detail: 'The service is reachable from any network the host is on, not just locally.',
    remediation:
      'Bind to `127.0.0.1` unless it genuinely needs to be reachable, in which case make sure a firewall is what is deciding.',
  },
]

export const RULES_BY_ID = new Map(SAST_RULES.map((rule) => [rule.id, rule]))
