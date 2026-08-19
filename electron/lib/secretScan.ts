/**
 * Finding credentials that have been committed.
 *
 * The hard part is not spotting secrets — it is not reporting a thousand
 * things that are not secrets. A scanner that cries wolf gets turned off, and
 * then it finds nothing at all. So two kinds of rule are used, and they are
 * deliberately different in character:
 *
 *   - **Known formats.** A GitHub token, an AWS key id, a Stripe key and a
 *     private-key header all have shapes that nothing else has. These are
 *     reported as `confirmed`: there is no innocent reason for that string.
 *
 *   - **Assignment plus entropy.** `apiKey = "…"` where the value looks random.
 *     Reported as `likely` at best, because a long random-looking string is
 *     also what a hash, a UUID, a checksum and a minified bundle look like.
 *
 * Everything reported is redacted before it leaves this module. A scanner that
 * prints the secret it found has published it into a log.
 */
import type { Confidence, Severity } from '../../shared/security'

export interface SecretHit {
  rule: string
  title: string
  detail: string
  remediation: string
  severity: Severity
  confidence: Confidence
  line: number
  column: number
  endColumn: number
  /** The line with the secret masked. */
  excerpt: string
  cwe: string
}

interface KnownFormat {
  rule: string
  title: string
  pattern: RegExp
  severity: Severity
  /** What to do, which differs per provider — most can be revoked directly. */
  remediation: string
}

/**
 * Formats with no plausible innocent explanation. Each pattern is anchored on
 * the provider's own prefix rather than on entropy, which is what makes these
 * safe to report as confirmed.
 */
const KNOWN_FORMATS: KnownFormat[] = [
  {
    rule: 'aws-access-key',
    title: 'AWS access key id',
    pattern: /\b((?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g,
    severity: 'critical',
    remediation: 'Deactivate the key in IAM, rotate it, and read it from the environment instead.',
  },
  {
    rule: 'github-token',
    title: 'GitHub token',
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g,
    severity: 'critical',
    remediation: 'Revoke it in GitHub → Settings → Developer settings, and use a secret store.',
  },
  {
    rule: 'slack-token',
    title: 'Slack token',
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    severity: 'high',
    remediation: 'Revoke it in the Slack app settings and re-issue it into the environment.',
  },
  {
    rule: 'stripe-key',
    title: 'Stripe secret key',
    pattern: /\b(sk_(?:live|test)_[A-Za-z0-9]{16,})\b/g,
    severity: 'critical',
    remediation: 'Roll the key in the Stripe dashboard. A live key here is a payments incident.',
  },
  {
    rule: 'google-api-key',
    title: 'Google API key',
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    severity: 'high',
    remediation: 'Regenerate it in the Google Cloud console and restrict it by referrer or IP.',
  },
  {
    rule: 'openai-key',
    title: 'OpenAI API key',
    pattern: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
    severity: 'critical',
    remediation: 'Revoke it in the OpenAI dashboard and read it from the environment.',
  },
  {
    rule: 'anthropic-key',
    title: 'Anthropic API key',
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    severity: 'critical',
    remediation: 'Revoke it in the Anthropic console and read it from the environment.',
  },
  {
    rule: 'private-key',
    title: 'Private key',
    pattern: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----)/g,
    severity: 'critical',
    remediation: 'Treat the key as compromised: generate a new pair and rotate everything trusting it.',
  },
  {
    rule: 'jwt',
    title: 'JSON Web Token',
    pattern: /\b(eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    severity: 'medium',
    remediation: 'A signed token in source is a live session. Revoke it and issue tokens at runtime.',
  },
  {
    rule: 'connection-string',
    title: 'Connection string with a password',
    // A URL with credentials in the authority. `:` then non-`@` then `@host`.
    pattern: /\b((?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|ftp):\/\/[^\s:/@]+:[^\s@/]{3,}@[^\s/]+)/gi,
    severity: 'high',
    remediation: 'Move the credential to an environment variable and build the URL at runtime.',
  },
]

/** Names that mean the value beside them is a credential. */
const SECRET_NAMES =
  /\b(?:api[_-]?key|apikey|secret|passwd|password|pwd|token|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|credential|session[_-]?key|encryption[_-]?key)\b/i

/** `name = "value"` in the shapes the common languages and config formats use. */
const ASSIGNMENT =
  /([A-Za-z_][A-Za-z0-9_.-]*)\s*(?::=|=>|[:=])\s*(?:"([^"\n]{8,})"|'([^'\n]{8,})'|`([^`\n]{8,})`)/g

/**
 * Values that look like secrets but are not, and appear constantly. Left as a
 * list rather than an entropy threshold because these are *specific* — the
 * point is to name them, so a reader can tell whether the exclusion is right.
 */
const OBVIOUS_PLACEHOLDERS =
  /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]*>|\$\{[^}]*\}|\{\{[^}]*\}\}|%[sd]|null|none|true|false|undefined|changeme|example|placeholder|your[_-]?\w+[_-]?here|todo|test|dummy|sample|redacted|insert[_-]?\w+|replace[_-]?\w+)$/i

/**
 * Structures that are high-entropy by nature. A UUID is not a secret; a
 * content hash is not a secret; a base64 image is not a secret.
 */
const NOT_A_SECRET = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // UUID
  /^(?:sha\d{3}|sha1|md5)[-:]/i, // subresource integrity / digest prefix
  /^data:[a-z]+\/[a-z0-9.+-]+;base64,/i, // inline asset
  /^[0-9a-f]{32,}$/i, // a bare hex digest
  /^https?:\/\//i, // a URL with no credential in it
  /^[/.~]/, // a path
  /^\d+(?:\.\d+)*$/, // a version
]

/** Files whose whole purpose is to hold examples of the above. */
const SAMPLE_FILE = /(?:\.example|\.sample|\.template|\.dist)(?:$|\.)|(?:^|[/\\])(?:fixtures?|__fixtures__|testdata|examples?)[/\\]/i

export function scanForSecrets(relativePath: string, text: string): SecretHit[] {
  const hits: SecretHit[] = []
  const lines = text.split(/\r?\n/)
  const isSample = SAMPLE_FILE.test(relativePath)

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    // A minified bundle is one enormous line of high-entropy text; scanning it
    // produces nothing but noise.
    if (line.length > 2000) continue
    if (/\bnosec\b|\bnova-ignore\b|\bgitleaks:allow\b/.test(line)) continue

    hits.push(...matchKnownFormats(line, index + 1, isSample))
    hits.push(...matchAssignments(line, index + 1, isSample))
  }

  return hits
}

function matchKnownFormats(line: string, lineNumber: number, isSample: boolean): SecretHit[] {
  const hits: SecretHit[] = []

  for (const format of KNOWN_FORMATS) {
    format.pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = format.pattern.exec(line))) {
      const value = match[1]
      hits.push({
        rule: format.rule,
        title: format.title,
        detail: `A ${format.title.toLowerCase()} appears in this file.`,
        remediation: format.remediation,
        // In a sample file the shape is the point, so it is reported quietly
        // rather than not at all — a real key does end up in `.env.example`.
        severity: isSample ? 'low' : format.severity,
        confidence: isSample ? 'possible' : 'confirmed',
        line: lineNumber,
        column: match.index + 1,
        endColumn: match.index + value.length + 1,
        excerpt: redactLine(line, match.index, value.length),
        cwe: 'CWE-798',
      })
    }
  }

  return hits
}

function matchAssignments(line: string, lineNumber: number, isSample: boolean): SecretHit[] {
  const hits: SecretHit[] = []
  ASSIGNMENT.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = ASSIGNMENT.exec(line))) {
    const name = match[1]
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (!SECRET_NAMES.test(name)) continue
    if (!looksSecret(value)) continue

    const at = line.indexOf(value, match.index)
    hits.push({
      rule: 'hardcoded-credential',
      title: 'Hardcoded credential',
      detail: `\`${name}\` is assigned a literal value that looks like a credential.`,
      remediation:
        'Read it from the environment or a secret store, and rotate it — anything committed should be treated as public.',
      severity: isSample ? 'low' : 'high',
      // Never better than `likely`: this is a name and a shape, not proof.
      confidence: isSample ? 'possible' : 'likely',
      line: lineNumber,
      column: at + 1,
      endColumn: at + value.length + 1,
      excerpt: redactLine(line, at, value.length),
      cwe: 'CWE-798',
    })
  }

  return hits
}

/** Whether a value is random enough, and unremarkable enough, to worry about. */
export function looksSecret(value: string): boolean {
  if (value.length < 8) return false
  if (OBVIOUS_PLACEHOLDERS.test(value)) return false
  if (NOT_A_SECRET.some((pattern) => pattern.test(value))) return false
  // A value made of words is a sentence, not a key.
  if (/^[a-z]+(?:[ _-][a-z]+){2,}$/i.test(value)) return false
  return entropy(value) >= 3.2 || /^[A-Za-z0-9+/=_-]{24,}$/.test(value)
}

/**
 * Shannon entropy per character.
 *
 * A rough but effective discriminator: English prose sits near 2.5–3, while
 * base64 and hex keys sit above 3.5. The threshold is deliberately on the
 * permissive side, with the placeholder and structure lists doing the work of
 * keeping the false positives down — an entropy cut-off alone would either
 * miss short keys or flag every hash in the repository.
 */
export function entropy(value: string): number {
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)

  let total = 0
  for (const count of counts.values()) {
    const p = count / value.length
    total -= p * Math.log2(p)
  }
  return total
}

/**
 * Replaces a secret with a marker, keeping the surrounding line readable.
 *
 * The last four characters are kept so two findings can be told apart and a
 * user can match one against their provider's dashboard, which lists key
 * suffixes for exactly this reason.
 */
export function redactLine(line: string, start: number, length: number): string {
  const secret = line.slice(start, start + length)
  const tail = secret.length > 8 ? secret.slice(-4) : ''
  const masked = `${'•'.repeat(Math.min(12, Math.max(4, secret.length - 4)))}${tail}`
  const out = line.slice(0, start) + masked + line.slice(start + length)
  return out.length > 200 ? `${out.slice(0, 200)}…` : out
}
