/**
 * Parses `.http` / `.rest` files.
 *
 * The base format is the one IntelliJ and the VS Code REST Client share, which
 * is worth matching exactly: users arrive with files already written against
 * it, and a near-miss dialect is worse than none. Requests are separated by
 * `###`, a request is `METHOD url` followed by headers, a blank line, then a
 * body.
 *
 * Everything past plain HTTP is an additive extension, chosen so a file that
 * uses none of it still parses identically in any other tool:
 *
 *   - extra verbs — `GRAPHQL`, `GRPC`, `WEBSOCKET`, `SSE` — in the method slot
 *   - `# @directive` lines, which are ordinary comments elsewhere
 *   - `< ./file` and `--form` / `--variables` blocks inside the body
 *
 * Parsing is line-based rather than a regex over the whole file because the
 * error messages need line numbers to be useful, and because a body can
 * legitimately contain anything — including text that looks like a request
 * line.
 */
import type {
  AuthScheme,
  HttpBody,
  HttpFile,
  HttpProtocol,
  HttpRequest,
  MultipartPart,
} from '../../shared/http'

const METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CONNECT',
])

/** The verbs that select a protocol rather than an HTTP method. */
const PROTOCOL_VERBS: Record<string, HttpProtocol> = {
  GRAPHQL: 'graphql',
  GRPC: 'grpc',
  WEBSOCKET: 'websocket',
  WS: 'websocket',
  SSE: 'sse',
}

/** What a `# @directive` can set, before it is known which request it is for. */
interface Settings {
  name?: string
  auth?: AuthScheme
  timeoutMs?: number
  followRedirects?: boolean
  useCookies?: boolean
  protoPath?: string
  dataPath?: string
  specPath?: string
  initialMessages: string[]
}

interface Draft {
  name: string
  line: number
  protocol: HttpProtocol
  method: string
  url: string
  grpcMethod?: string
  headers: { name: string; value: string }[]
  bodyLines: string[]
  inBody: boolean
  auth: AuthScheme
  timeoutMs?: number
  followRedirects: boolean
  useCookies: boolean
  protoPath?: string
  dataPath?: string
  specPath?: string
  initialMessages: string[]
}

/**
 * A `< {% %}` or `> {% %}` block, and where the body resumes after it.
 *
 * Scripts are pulled out of the body text rather than parsed line by line,
 * because their content is JavaScript — it can contain anything, including
 * lines that look like headers, separators or other script markers.
 */
function extractScripts(body: string): {
  body: string
  preScript?: string
  postScript?: string
} {
  let rest = body
  let preScript: string | undefined
  let postScript: string | undefined

  for (const [marker, assign] of [
    ['<', (value: string) => (preScript = value)],
    ['>', (value: string) => (postScript = value)],
  ] as const) {
    const opener = new RegExp(`^[ \\t]*\\${marker}\\s*\\{%`, 'm').exec(rest)
    if (!opener) continue
    const start = opener.index + opener[0].length
    const end = rest.indexOf('%}', start)
    if (end === -1) continue
    assign(rest.slice(start, end).trim())
    rest = `${rest.slice(0, opener.index)}${rest.slice(end + 2)}`
  }

  return { body: rest.replace(/\s+$/, ''), preScript, postScript }
}

export function parseHttpFile(text: string): HttpFile {
  const lines = text.split(/\r?\n/)
  const requests: HttpRequest[] = []
  const variables: Record<string, string> = {}
  const errors: string[] = []

  let current: Draft | null = null
  // Directives are written above the request line they configure, so they are
  // collected here and folded in once that line appears.
  let pending: Settings = { initialMessages: [] }

  const flush = () => {
    if (!current) return
    if (!current.method) {
      current = null
      return
    }
    const whole = current.bodyLines.join('\n').replace(/\s+$/, '')
    const { body: raw, preScript, postScript } = extractScripts(whole)
    requests.push({
      id: `req-${requests.length}`,
      name: current.name || `${current.method} ${shortUrl(current.url)}`,
      protocol: current.protocol,
      method: current.method,
      url: current.url,
      headers: current.headers,
      body: parseBody(current.protocol, raw, errors, current.line),
      preScript,
      postScript,
      dataPath: current.dataPath,
      specPath: current.specPath,
      auth: current.auth,
      line: current.line,
      timeoutMs: current.timeoutMs,
      followRedirects: current.followRedirects,
      useCookies: current.useCookies,
      grpcMethod: current.grpcMethod,
      protoPath: current.protoPath,
      initialMessages: current.initialMessages,
    })
    current = null
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()

    // A separator ends the previous request and may name the next.
    if (line.startsWith('###')) {
      flush()
      pending = { initialMessages: [] }
      const name = line.replace(/^#+/, '').trim()
      if (name) pending.name = name
      continue
    }

    // Directives are comments to every other tool, so they must be read before
    // comments are skipped — and only outside a body, where `#` is content.
    if (!current?.inBody && /^(#|\/\/)\s*@/.test(line)) {
      const directive = line.replace(/^(#|\/\/)\s*@/, '')
      applyDirective(directive, i + 1, current ?? pending, errors)
      continue
    }

    // Comments, but only outside a body — `#` is valid JSON string content.
    if (!current?.inBody && (line.startsWith('//') || line.startsWith('#'))) continue

    // File-level variables: `@base = https://example.com`
    if (!current && line.startsWith('@')) {
      const match = /^@([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(line)
      if (match) variables[match[1]] = match[2].trim()
      else errors.push(`Line ${i + 1}: could not read variable declaration.`)
      continue
    }

    if (!current) {
      if (!line) continue
      const parsed = parseRequestLine(line)
      if (!parsed) {
        errors.push(`Line ${i + 1}: expected a request like \`GET https://example.com\`.`)
        continue
      }
      current = {
        name: pending.name ?? '',
        line: i + 1,
        protocol: parsed.protocol,
        method: parsed.method,
        url: parsed.url,
        grpcMethod: parsed.grpcMethod,
        headers: [],
        bodyLines: [],
        inBody: false,
        // Directives written above the request line configure it, and are
        // the usual place to put them.
        auth: pending.auth ?? { kind: 'none' },
        timeoutMs: pending.timeoutMs,
        followRedirects: pending.followRedirects ?? true,
        useCookies: pending.useCookies ?? true,
        protoPath: pending.protoPath,
        dataPath: pending.dataPath,
        specPath: pending.specPath,
        initialMessages: [...pending.initialMessages],
      }
      pending = { initialMessages: [] }
      continue
    }

    if (current.inBody) {
      current.bodyLines.push(raw)
      continue
    }

    // A blank line ends the header block and starts the body.
    if (!line) {
      current.inBody = true
      continue
    }

    // A URL continuation: a line starting with `?` or `&` extends the previous.
    if (line.startsWith('?') || line.startsWith('&')) {
      current.url += line
      continue
    }

    const separator = line.indexOf(':')
    if (separator === -1) {
      errors.push(`Line ${i + 1}: expected \`Header: value\`.`)
      continue
    }
    current.headers.push({
      name: line.slice(0, separator).trim(),
      value: line.slice(separator + 1).trim(),
    })
  }

  flush()
  return { requests, variables, errors }
}

/* ---------------- directives ---------------- */

/**
 * Directives configure the request they belong to. Written above the request
 * line — which is where they read most naturally, and where IntelliJ puts
 * `@name` — they land on a pending Settings; written below it they land on the
 * draft directly. Both shapes share these fields, so one function serves both.
 */
function applyDirective(
  directive: string,
  lineNumber: number,
  target: Settings | Draft,
  errors: string[],
) {
  const space = directive.search(/\s/)
  const keyword = (space === -1 ? directive : directive.slice(0, space)).toLowerCase()
  const rest = space === -1 ? '' : directive.slice(space + 1).trim()

  switch (keyword) {
    case 'name':
      target.name = rest
      return

    case 'auth': {
      const auth = parseAuth(rest)
      if (!auth) errors.push(`Line ${lineNumber}: could not read \`@auth ${rest}\`.`)
      else target.auth = auth
      return
    }

    case 'timeout': {
      const ms = Number(rest)
      if (!Number.isFinite(ms) || ms <= 0) {
        errors.push(`Line ${lineNumber}: \`@timeout\` needs a positive number of milliseconds.`)
        return
      }
      target.timeoutMs = ms
      return
    }

    case 'no-redirect':
      target.followRedirects = false
      return

    case 'no-cookies':
      target.useCookies = false
      return

    case 'proto':
      target.protoPath = rest
      return

    case 'data':
      target.dataPath = rest
      return

    case 'spec':
      target.specPath = rest
      return

    case 'send':
      target.initialMessages.push(rest)
      return

    default:
      // An unknown directive is a comment, not an error: other tools put their
      // own `@` annotations in these files and Nova should not reject them.
      return
  }
}

/**
 * `@auth` takes a scheme and then either positional arguments, for the short
 * schemes, or `key=value` pairs where positional would be unreadable.
 */
export function parseAuth(input: string): AuthScheme | null {
  const parts = splitArgs(input)
  const scheme = (parts[0] ?? '').toLowerCase()

  if (scheme === 'none') return { kind: 'none' }

  if (scheme === 'basic') {
    if (parts.length < 3) return null
    return { kind: 'basic', username: parts[1], password: parts.slice(2).join(' ') }
  }

  if (scheme === 'bearer') {
    if (parts.length < 2) return null
    return { kind: 'bearer', token: parts.slice(1).join(' ') }
  }

  if (scheme === 'apikey') {
    const where = (parts[1] ?? '').toLowerCase()
    if ((where !== 'header' && where !== 'query') || parts.length < 4) return null
    return { kind: 'apikey', in: where, name: parts[2], value: parts.slice(3).join(' ') }
  }

  if (scheme === 'oauth2') {
    const options = keyValues(parts.slice(1))
    const grant = options.grant === 'password' ? 'password' : 'client_credentials'
    const tokenUrl = options.token_url ?? options.tokenurl ?? ''
    if (!tokenUrl) return null
    return {
      kind: 'oauth2',
      grant,
      tokenUrl,
      clientId: options.client_id ?? '',
      clientSecret: options.client_secret ?? '',
      username: options.username,
      password: options.password,
      scope: options.scope,
      clientAuth: options.client_auth === 'body' ? 'body' : 'header',
    }
  }

  return null
}

/** Splits on whitespace, but keeps quoted runs together. */
function splitArgs(input: string): string[] {
  const out: string[] = []
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(input))) out.push(match[1] ?? match[2] ?? match[3])
  return out
}

function keyValues(parts: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of parts) {
    const at = part.indexOf('=')
    if (at > 0) out[part.slice(0, at).toLowerCase()] = part.slice(at + 1)
  }
  return out
}

/* ---------------- bodies ---------------- */

/**
 * A body is text unless it opens with a block marker. The markers are chosen
 * to be things no real payload starts with, so an ordinary JSON body is never
 * misread as one.
 */
function parseBody(
  protocol: HttpProtocol,
  raw: string,
  errors: string[],
  requestLine: number,
): HttpBody {
  const text = raw.trim()

  if (protocol === 'graphql') return parseGraphqlBody(raw)

  if (!text) return { kind: 'none' }

  // `< ./payload.json` — the whole body comes from a file.
  const include = /^<\s*(\S.*)$/.exec(text)
  if (include && !text.includes('\n')) return { kind: 'file', path: include[1].trim() }

  if (text.startsWith('--form')) return parseMultipart(raw, errors, requestLine)

  return { kind: 'text', text: raw.replace(/^\n+/, '') }
}

/**
 * GraphQL bodies keep the query and the variables apart, because the two are
 * edited independently and sending them as one blob would mean re-parsing the
 * document every time a variable changes.
 */
function parseGraphqlBody(raw: string): HttpBody {
  const marker = /^\s*--variables\s*$/m.exec(raw)
  const query = (marker ? raw.slice(0, marker.index) : raw).trim()
  const variables = marker ? raw.slice(marker.index + marker[0].length).trim() : ''

  const named = /^\s*(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(query)
  return {
    kind: 'graphql',
    query,
    variables: variables || '{}',
    operationName: named?.[1],
  }
}

/**
 * Multipart parts are `--form` followed by `key: value` lines. A part with a
 * `filename` reads that file at send time rather than inlining it here, so a
 * large upload never sits in the parse tree.
 */
function parseMultipart(raw: string, errors: string[], requestLine: number): HttpBody {
  const parts: MultipartPart[] = []
  let part: MultipartPart | null = null

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('--form')) {
      if (part) parts.push(part)
      part = { name: '' }
      continue
    }
    if (!part) continue

    const at = trimmed.indexOf(':')
    if (at === -1) continue
    const key = trimmed.slice(0, at).trim().toLowerCase()
    const value = trimmed.slice(at + 1).trim()

    if (key === 'name') part.name = value
    else if (key === 'value') part.value = value
    else if (key === 'filename') part.filename = value
    else if (key === 'type' || key === 'content-type') part.contentType = value
  }
  if (part) parts.push(part)

  const unnamed = parts.filter((p) => !p.name).length
  if (unnamed) errors.push(`Line ${requestLine}: a multipart part is missing its \`name\`.`)

  return { kind: 'multipart', parts: parts.filter((p) => p.name) }
}

/* ---------------- request line ---------------- */

interface ParsedLine {
  protocol: HttpProtocol
  method: string
  url: string
  grpcMethod?: string
}

function parseRequestLine(line: string): ParsedLine | null {
  const parts = line.split(/\s+/).filter(Boolean)
  const head = (parts[0] ?? '').toUpperCase()

  // gRPC carries a method path as well as an address:
  //   GRPC localhost:50051 billing.Orders/Compute
  if (head === 'GRPC') {
    if (parts.length < 2) return null
    return {
      protocol: 'grpc',
      method: 'GRPC',
      url: parts[1],
      grpcMethod: parts[2],
    }
  }

  const protocol = PROTOCOL_VERBS[head]
  if (protocol) {
    if (parts.length < 2) return null
    return { protocol, method: head === 'WS' ? 'WEBSOCKET' : head, url: parts.slice(1).join(' ') }
  }

  if (parts.length >= 2 && METHODS.has(head)) {
    // Drop a trailing HTTP/1.1 if present.
    const url = parts.slice(1).filter((p) => !/^HTTP\/[\d.]+$/i.test(p)).join(' ')
    return { protocol: 'http', method: head, url }
  }

  // A bare URL is a GET, which is what both reference implementations do.
  if (parts.length === 1 && /^(https?:\/\/|\{\{)/.test(parts[0])) {
    return { protocol: 'http', method: 'GET', url: parts[0] }
  }
  // A bare websocket URL needs no verb either — the scheme already says it.
  if (parts.length === 1 && /^wss?:\/\//.test(parts[0])) {
    return { protocol: 'websocket', method: 'WEBSOCKET', url: parts[0] }
  }
  return null
}

/* ---------------- interpolation ---------------- */

/**
 * Substitutes `{{name}}` from the environment, then file variables.
 *
 * Unresolved placeholders are deliberately left as-is rather than blanked: a
 * request to `https://{{host}}/users` failing loudly is easier to diagnose than
 * one that silently becomes `https:///users`.
 */
export function interpolate(
  value: string,
  variables: Record<string, string>,
  environment: Record<string, string> = {},
): string {
  return value.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (whole, name: string) => {
    if (name in environment) return environment[name]
    if (name in variables) return variables[name]
    // Also allow process env for secrets a user does not want in the file.
    const fromEnv = process.env[name]
    return fromEnv ?? whole
  })
}

/** Applies `interpolate` everywhere a request can carry a variable. */
export function interpolateRequest(
  request: HttpRequest,
  variables: Record<string, string>,
  environment: Record<string, string>,
): HttpRequest {
  const fill = (value: string) => interpolate(value, variables, environment)

  return {
    ...request,
    url: fill(request.url),
    grpcMethod: request.grpcMethod ? fill(request.grpcMethod) : undefined,
    protoPath: request.protoPath ? fill(request.protoPath) : undefined,
    headers: request.headers.map((h) => ({ name: h.name, value: fill(h.value) })),
    auth: fillAuth(request.auth, fill),
    body: fillBody(request.body, fill),
    initialMessages: request.initialMessages.map(fill),
  }
}

function fillAuth(auth: AuthScheme, fill: (v: string) => string): AuthScheme {
  switch (auth.kind) {
    case 'basic':
      return { ...auth, username: fill(auth.username), password: fill(auth.password) }
    case 'bearer':
      return { ...auth, token: fill(auth.token) }
    case 'apikey':
      return { ...auth, name: fill(auth.name), value: fill(auth.value) }
    case 'oauth2':
      return {
        ...auth,
        tokenUrl: fill(auth.tokenUrl),
        clientId: fill(auth.clientId),
        clientSecret: fill(auth.clientSecret),
        username: auth.username ? fill(auth.username) : undefined,
        password: auth.password ? fill(auth.password) : undefined,
        scope: auth.scope ? fill(auth.scope) : undefined,
      }
    default:
      return auth
  }
}

function fillBody(body: HttpBody, fill: (v: string) => string): HttpBody {
  switch (body.kind) {
    case 'text':
      return { kind: 'text', text: fill(body.text) }
    case 'file':
      return { kind: 'file', path: fill(body.path) }
    case 'multipart':
      return {
        kind: 'multipart',
        parts: body.parts.map((p) => ({
          ...p,
          value: p.value === undefined ? undefined : fill(p.value),
          filename: p.filename === undefined ? undefined : fill(p.filename),
        })),
      }
    case 'graphql':
      return {
        kind: 'graphql',
        query: fill(body.query),
        variables: fill(body.variables),
        operationName: body.operationName,
      }
    default:
      return body
  }
}

function shortUrl(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}…` : url
}
