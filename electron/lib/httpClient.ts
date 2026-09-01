/**
 * Sending an HTTP request and reading the response.
 *
 * Redirects are followed by hand rather than by `fetch`, for three reasons the
 * automatic mode cannot give: the cookie jar has to be consulted and updated at
 * every hop (a login flow usually sets its session on the redirect, not on the
 * response you end up reading), the chain has to be reportable so a redirect
 * loop is visible, and the method rewriting rules differ between 302 and 308 in
 * a way that matters when a POST is involved.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { HttpBody, HttpRequest, HttpResponse, RedirectHop } from '../../shared/http'
import { applyAuth, redactHeaders, redactUrl } from './httpAuth'
import { PathEscapeError, resolveInRoot } from './workspacePath'
import type { CookieJar } from './cookieJar'

export interface SendContext {
  jar: CookieJar
  /** Directory of the `.http` file, for resolving `< ./file` and upload paths. */
  baseDir: string
  /**
   * The open project. Every path a `.http` file names has to land inside it.
   *
   * Optional because the CLI runner and the tests drive requests with no
   * project open; when it is absent the `.http` file's own directory is the
   * boundary instead, which is narrower rather than wider.
   */
  projectRoot?: string
  defaultTimeoutMs: number
  maxBodyBytes: number
}

/** More hops than this is a loop, not a route. */
const MAX_REDIRECTS = 10

export async function sendHttpRequest(
  request: HttpRequest,
  ctx: SendContext,
): Promise<HttpResponse> {
  const started = Date.now()
  const base = (): HttpResponse => ({
    requestId: request.id,
    protocol: request.protocol,
    status: 0,
    statusText: '',
    headers: {},
    body: '',
    size: 0,
    contentType: '',
    durationMs: Date.now() - started,
    at: started,
    redirects: [],
    cookies: [],
  })

  // A leftover placeholder means the request would go somewhere unintended.
  const unresolved = /\{\{[A-Za-z0-9_-]+\}\}/.exec(request.url)
  if (unresolved) {
    return {
      ...base(),
      error: `Unresolved variable in URL: ${request.url}. Declare it with \`@name = value\` or pick an environment.`,
    }
  }

  const auth = await applyAuth(request.auth)
  if (auth.error) return { ...base(), error: auth.error }

  let payload: { body: BodyInit | undefined; headers: Record<string, string> }
  try {
    payload = await buildBody(request.body, ctx.baseDir, ctx.projectRoot ?? ctx.baseDir)
  } catch (err) {
    return { ...base(), error: (err as Error).message }
  }

  const headers: Record<string, string> = {}
  for (const header of request.headers) headers[header.name] = header.value
  Object.assign(headers, auth.headers)
  // A body-derived content type is a default: an explicit header in the file
  // wins, because that is the only way to send a deliberately odd one.
  for (const [name, value] of Object.entries(payload.headers)) {
    if (!hasHeader(headers, name)) headers[name] = value
  }

  let url: string
  try {
    url = withQuery(request.url, auth.query)
  } catch {
    return { ...base(), error: `Not a valid URL: ${request.url}` }
  }

  const timeout = request.timeoutMs ?? ctx.defaultTimeoutMs
  const redirects: RedirectHop[] = []
  const cookiesSet: string[] = []

  /**
   * Everything that authenticates this request, by header name.
   *
   * The fixed three are the ones every client knows about. The rest come from
   * `applyAuth`, because an API key scheme puts its secret in a header the user
   * named — `X-Company-Token` is a credential and `X-Request-Id` is not, and
   * only the thing that set it can tell them apart.
   */
  const credentialHeaders = new Set(
    ['authorization', 'proxy-authorization', 'cookie', ...Object.keys(auth.headers)].map((name) =>
      name.toLowerCase(),
    ),
  )

  // `GRAPHQL` is Nova's verb for picking the protocol, not something to put on
  // the wire — GraphQL over HTTP is a POST, and a server handed an unknown
  // method rejects it before it ever reads the query.
  let method = request.protocol === 'graphql' ? 'POST' : request.method
  let body = payload.body
  let sentHeaders: Record<string, string> = {}

  for (let hop = 0; ; hop++) {
    if (hop > MAX_REDIRECTS) {
      return { ...base(), redirects, cookies: cookiesSet, error: `More than ${MAX_REDIRECTS} redirects — the chain does not terminate.` }
    }

    const hopHeaders = { ...headers }
    if (request.useCookies) {
      const cookie = ctx.jar.header(url)
      if (cookie) hopHeaders.Cookie = cookie
    }
    sentHeaders = hopHeaders

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers: hopHeaders,
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeout),
      })
    } catch (err) {
      const error = err as Error
      return {
        ...base(),
        redirects,
        cookies: cookiesSet,
        error:
          error.name === 'TimeoutError' || error.name === 'AbortError'
            ? `Timed out after ${timeout / 1000}s.`
            : error.message,
      }
    }

    if (request.useCookies) {
      cookiesSet.push(...ctx.jar.accept(url, getSetCookie(response)))
    }

    const location = response.headers.get('location')
    if (request.followRedirects && isRedirect(response.status) && location) {
      let next: string
      try {
        next = new URL(location, url).toString()
      } catch {
        return { ...base(), redirects, cookies: cookiesSet, error: `Redirect to an unreadable location: ${location}` }
      }
      // A redirect that leaves the origin must not take the credentials with
      // it. `redirect: 'manual'` means Nova follows the chain itself, so the
      // browser rule that would have applied here has to be applied here: an
      // open redirect on an authenticated host would otherwise hand a bearer
      // token to whatever host the attacker named.
      const hop: RedirectHop = { status: response.status, from: url, to: next }
      if (!sameOrigin(url, next)) {
        const dropped: string[] = []
        for (const name of Object.keys(headers)) {
          if (credentialHeaders.has(name.toLowerCase())) {
            delete headers[name]
            dropped.push(name)
          }
        }
        if (dropped.length) hop.strippedCredentials = dropped
      }
      redirects.push(hop)

      // 303 always becomes a GET; 301 and 302 do in practice, which is what
      // every browser does and what servers now expect. 307 and 308 exist
      // precisely to preserve the method, so they do.
      if (response.status === 303 || response.status === 301 || response.status === 302) {
        if (method !== 'HEAD') method = 'GET'
        body = undefined
        delete headers['Content-Type']
        delete headers['content-type']
      }
      url = next
      continue
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const truncated = buffer.length > ctx.maxBodyBytes
    const shown = truncated ? buffer.subarray(0, ctx.maxBodyBytes) : buffer

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value
    })

    return {
      requestId: request.id,
      protocol: request.protocol,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: shown.toString('utf8') + (truncated ? '\n\n… response truncated for display …' : ''),
      size: buffer.length,
      contentType: response.headers.get('content-type') ?? '',
      durationMs: Date.now() - started,
      at: started,
      redirects,
      cookies: cookiesSet,
      sent: {
        method,
        // An API key placed in the query string is just as much a credential as
        // one in a header, and this record is what the history file keeps.
        url: redactUrl(url, Object.keys(auth.query)),
        headers: redactHeaders(sentHeaders, Object.keys(auth.headers)),
        body: describeBody(request.body),
      },
    }
  }
}

/* ---------------- bodies ---------------- */

/**
 * Turns a parsed body into something `fetch` accepts, plus the headers that
 * body implies. File reads happen here rather than at parse time so a large
 * upload is never held in the parse tree.
 */
export async function buildBody(
  body: HttpBody,
  baseDir: string,
  projectRoot: string = baseDir,
): Promise<{ body: BodyInit | undefined; headers: Record<string, string> }> {
  switch (body.kind) {
    case 'none':
      return { body: undefined, headers: {} }

    case 'text':
      return { body: body.text, headers: guessContentType(body.text) }

    case 'file': {
      // `< ./payload.json` is the author naming a file next to their own, so it
      // resolves against the file's directory — but it is still a path from an
      // untrusted repository, and the body goes to a server the same file names.
      const file = await resolveInRoot(projectRoot, body.path, { base: baseDir }).catch((err) => {
        if (err instanceof PathEscapeError) {
          throw new Error(`The request body ${body.path} is outside the open project.`)
        }
        throw err
      })
      let contents: Buffer
      try {
        contents = await fs.readFile(file)
      } catch {
        throw new Error(`Could not read the request body from ${body.path}.`)
      }
      return {
        body: new Uint8Array(contents),
        headers: guessContentType(contents.subarray(0, 200).toString('utf8'), file),
      }
    }

    case 'multipart': {
      const boundary = `----NovaBoundary${randomBoundary()}`
      const encoded = await encodeMultipart(body.parts, baseDir, boundary, projectRoot)
      return {
        body: new Uint8Array(encoded),
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      }
    }

    case 'graphql': {
      let variables: unknown = {}
      if (body.variables.trim()) {
        try {
          variables = JSON.parse(body.variables)
        } catch (err) {
          throw new Error(`GraphQL variables are not valid JSON: ${(err as Error).message}`)
        }
      }
      const payload: Record<string, unknown> = { query: body.query, variables }
      if (body.operationName) payload.operationName = body.operationName
      return {
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      }
    }
  }
}

/**
 * Builds a `multipart/form-data` payload.
 *
 * Assembled as raw bytes rather than through `FormData` because a part may be
 * a file of arbitrary content, and round-tripping that through a string would
 * corrupt anything that is not valid UTF-8.
 */
async function encodeMultipart(
  parts: { name: string; value?: string; filename?: string; contentType?: string }[],
  baseDir: string,
  boundary: string,
  projectRoot: string,
): Promise<Buffer> {
  const chunks: Buffer[] = []

  for (const part of parts) {
    let disposition = `form-data; name="${escapeQuotes(part.name)}"`
    let contents: Buffer
    let contentType = part.contentType

    if (part.filename !== undefined) {
      const file = await resolveInRoot(projectRoot, part.filename, { base: baseDir }).catch((err) => {
        if (err instanceof PathEscapeError) {
          throw new Error(`The upload ${part.filename} is outside the open project.`)
        }
        throw err
      })
      try {
        contents = await fs.readFile(file)
      } catch {
        throw new Error(`Could not read the upload ${part.filename} for part "${part.name}".`)
      }
      disposition += `; filename="${escapeQuotes(path.basename(file))}"`
      contentType ??= contentTypeForPath(file)
    } else {
      contents = Buffer.from(part.value ?? '', 'utf8')
    }

    let head = `--${boundary}\r\nContent-Disposition: ${disposition}\r\n`
    if (contentType) head += `Content-Type: ${contentType}\r\n`
    head += '\r\n'

    chunks.push(Buffer.from(head, 'utf8'), contents, Buffer.from('\r\n', 'utf8'))
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))
  return Buffer.concat(chunks)
}

/**
 * A content type for a body that did not declare one. Guessing beats sending
 * nothing: an API that rejects a JSON body for want of a header is a confusing
 * first experience, and an explicit header in the file always wins anyway.
 */
function guessContentType(sample: string, file?: string): Record<string, string> {
  if (file) {
    const byExtension = contentTypeForPath(file)
    if (byExtension) return { 'Content-Type': byExtension }
  }
  const trimmed = sample.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return { 'Content-Type': 'application/json' }
  }
  if (trimmed.startsWith('<')) return { 'Content-Type': 'application/xml' }
  return {}
}

const EXTENSION_TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.bin': 'application/octet-stream',
}

function contentTypeForPath(file: string): string {
  return EXTENSION_TYPES[path.extname(file).toLowerCase()] ?? ''
}

/** What to show in the request pane, without re-reading a file to do it. */
function describeBody(body: HttpBody): string {
  switch (body.kind) {
    case 'none':
      return ''
    case 'text':
      return body.text
    case 'file':
      return `< ${body.path}`
    case 'multipart':
      return body.parts
        .map((p) => (p.filename ? `${p.name}: < ${p.filename}` : `${p.name}: ${p.value ?? ''}`))
        .join('\n')
    case 'graphql':
      return body.variables && body.variables !== '{}'
        ? `${body.query}\n\n--variables\n${body.variables}`
        : body.query
  }
}

/* ---------------- small helpers ---------------- */

/**
 * Whether two URLs share scheme, host and port.
 *
 * Compared as parsed origins rather than as strings, so `https://api.example.com`
 * and `https://api.example.com:443` are the one host they actually are. An
 * unparseable side answers false, which drops the credentials — the safe way
 * round when the destination cannot be read.
 */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/**
 * `Set-Cookie` is the one header that legitimately repeats, and the plain
 * `headers.get` join would merge them into a single unparseable string.
 */
function getSetCookie(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = response.headers.get('set-cookie')
  return single ? [single] : []
}

function withQuery(url: string, query: Record<string, string>): string {
  if (!Object.keys(query).length) return url
  const parsed = new URL(url)
  for (const [name, value] of Object.entries(query)) parsed.searchParams.set(name, value)
  return parsed.toString()
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase()
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted)
}

function escapeQuotes(value: string): string {
  return value.replace(/"/g, '%22').replace(/[\r\n]/g, '')
}

function randomBoundary(): string {
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
}
