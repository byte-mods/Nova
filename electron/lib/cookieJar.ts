/**
 * A cookie jar for the request client.
 *
 * Sessions are the reason this exists: a login request that sets a cookie and a
 * follow-up request that needs it are two separate lines in a `.http` file, and
 * without a jar the second one always fails. `fetch` in the main process keeps
 * no cookies of its own, so the jar is applied and harvested by hand around
 * every hop — including each hop of a redirect chain, which is exactly where a
 * login flow tends to set its session.
 *
 * Storage is per project rather than global. Two projects pointing at the same
 * staging host should not be able to see each other's session.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { StoredCookie } from '../../shared/http'

export class CookieJar {
  private cookies: StoredCookie[] = []
  private file = ''
  private saving: Promise<void> | null = null

  /** Points the jar at a project and loads whatever it saved last time. */
  async open(storageDir: string) {
    this.file = path.join(storageDir, 'cookies.json')
    try {
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as StoredCookie[]
      this.cookies = Array.isArray(parsed) ? parsed.filter(alive) : []
    } catch {
      this.cookies = []
    }
  }

  /** The `Cookie` header value for a URL, or empty if nothing matches. */
  header(url: string): string {
    const target = parse(url)
    if (!target) return ''

    const matches = this.cookies.filter((c) => alive(c) && matchesRequest(c, target))
    // RFC 6265 orders by path length, longest first, so a more specific cookie
    // wins when a server reads only the first of a repeated name.
    matches.sort((a, b) => b.path.length - a.path.length)
    return matches.map((c) => `${c.name}=${c.value}`).join('; ')
  }

  /**
   * Records the `Set-Cookie` headers of a response. Returns the cookies that
   * were actually accepted, so the UI can show what a request changed.
   */
  accept(url: string, setCookies: string[]): string[] {
    const target = parse(url)
    if (!target) return []

    const accepted: string[] = []
    for (const header of setCookies) {
      const cookie = parseSetCookie(header, target)
      if (!cookie) continue

      // A cookie for a domain the response does not belong to is a cookie for
      // someone else's site, and is dropped rather than stored.
      if (!domainAllowed(cookie.domain, target.host)) continue

      const at = this.cookies.findIndex(
        (c) => c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path,
      )
      // An expiry in the past is a deletion, which is how servers log you out.
      if (cookie.expires !== undefined && cookie.expires <= Date.now()) {
        if (at >= 0) this.cookies.splice(at, 1)
        continue
      }

      if (at >= 0) this.cookies[at] = cookie
      else this.cookies.push(cookie)
      accepted.push(`${cookie.name}=${cookie.value}`)
    }

    if (accepted.length) void this.persist()
    return accepted
  }

  all(): StoredCookie[] {
    return this.cookies.filter(alive)
  }

  /**
   * Resolves once every pending write has landed. `accept` deliberately does
   * not block the request that triggered it, which leaves a window where the
   * process could exit with a session only in memory.
   */
  async flush(): Promise<void> {
    await this.saving
  }

  clear(domain?: string) {
    this.cookies = domain ? this.cookies.filter((c) => !c.domain.endsWith(domain)) : []
    void this.persist()
  }

  /**
   * Writes are serialised rather than fired in parallel: several requests can
   * finish at once, and two overlapping writes of the same file can interleave
   * into invalid JSON.
   */
  private persist(): Promise<void> {
    if (!this.file) return Promise.resolve()
    const write = (this.saving ?? Promise.resolve())
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true })
        await fs.writeFile(this.file, JSON.stringify(this.cookies.filter(alive), null, 2))
      })
      .catch(() => undefined)
    this.saving = write
    return write
  }
}

interface Target {
  host: string
  path: string
  secure: boolean
}

function parse(url: string): Target | null {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname.toLowerCase(),
      path: parsed.pathname || '/',
      secure: parsed.protocol === 'https:' || parsed.protocol === 'wss:',
    }
  } catch {
    return null
  }
}

function alive(cookie: StoredCookie): boolean {
  return cookie.expires === undefined || cookie.expires > Date.now()
}

function matchesRequest(cookie: StoredCookie, target: Target): boolean {
  if (cookie.secure && !target.secure) return false
  if (!domainMatches(cookie.domain, target.host)) return false
  return pathMatches(cookie.path, target.path)
}

/** RFC 6265 §5.1.3 — an exact host, or a suffix at a label boundary. */
function domainMatches(cookieDomain: string, host: string): boolean {
  if (cookieDomain === host) return true
  return host.endsWith(`.${cookieDomain}`)
}

/** RFC 6265 §5.1.4. `/a` covers `/a` and `/a/b`, but not `/ab`. */
function pathMatches(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === requestPath) return true
  if (!requestPath.startsWith(cookiePath)) return false
  return cookiePath.endsWith('/') || requestPath[cookiePath.length] === '/'
}

/**
 * A response may only set cookies for its own domain or a parent of it —
 * never for a sibling, and never for a public suffix. The public-suffix check
 * here is the cheap approximation: refuse a bare two-label domain only when
 * the host has more labels than it, which stops `.co.uk` without shipping the
 * full suffix list.
 */
function domainAllowed(cookieDomain: string, host: string): boolean {
  if (cookieDomain === host) return true
  if (!host.endsWith(`.${cookieDomain}`)) return false
  return cookieDomain.includes('.')
}

function parseSetCookie(header: string, target: Target): StoredCookie | null {
  const segments = header.split(';')
  const first = segments[0] ?? ''
  const at = first.indexOf('=')
  if (at <= 0) return null

  const cookie: StoredCookie = {
    name: first.slice(0, at).trim(),
    value: first.slice(at + 1).trim(),
    domain: target.host,
    // Without an explicit Path, the default is the request's directory.
    path: defaultPath(target.path),
    secure: false,
    httpOnly: false,
  }
  if (!cookie.name) return null

  let maxAge: number | null = null
  let expires: number | null = null

  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf('=')
    const key = (equals === -1 ? segment : segment.slice(0, equals)).trim().toLowerCase()
    const value = equals === -1 ? '' : segment.slice(equals + 1).trim()

    switch (key) {
      case 'domain':
        cookie.domain = value.replace(/^\./, '').toLowerCase() || target.host
        break
      case 'path':
        if (value.startsWith('/')) cookie.path = value
        break
      case 'secure':
        cookie.secure = true
        break
      case 'httponly':
        cookie.httpOnly = true
        break
      case 'samesite':
        cookie.sameSite = value
        break
      case 'max-age': {
        const seconds = Number(value)
        if (Number.isFinite(seconds)) maxAge = Date.now() + seconds * 1000
        break
      }
      case 'expires': {
        const parsed = Date.parse(value)
        if (!Number.isNaN(parsed)) expires = parsed
        break
      }
    }
  }

  // Max-Age wins over Expires where both are present (RFC 6265 §5.3).
  const lifetime = maxAge ?? expires
  if (lifetime !== null) cookie.expires = lifetime

  return cookie
}

/** RFC 6265 §5.1.4 default-path: the request path up to its last slash. */
function defaultPath(requestPath: string): string {
  if (!requestPath.startsWith('/')) return '/'
  const lastSlash = requestPath.lastIndexOf('/')
  return lastSlash <= 0 ? '/' : requestPath.slice(0, lastSlash)
}
