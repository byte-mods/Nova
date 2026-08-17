/**
 * Parses `.http` / `.rest` files.
 *
 * The format is the one IntelliJ and the VS Code REST Client share, which is
 * worth matching exactly: users arrive with files already written against it,
 * and a near-miss dialect is worse than none. Requests are separated by `###`,
 * a request is `METHOD url` followed by headers, a blank line, then a body.
 *
 * Parsing is line-based rather than regex-over-the-whole-file because the error
 * messages need line numbers to be useful, and because a body can legitimately
 * contain anything — including text that looks like a request line.
 */
import type { HttpFile, HttpRequest } from '../../shared/http'

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

export function parseHttpFile(text: string): HttpFile {
  const lines = text.split(/\r?\n/)
  const requests: HttpRequest[] = []
  const variables: Record<string, string> = {}
  const errors: string[] = []

  /** Accumulates one request until the next `###`. */
  let current: {
    name: string
    line: number
    method: string
    url: string
    headers: { name: string; value: string }[]
    bodyLines: string[]
    inBody: boolean
  } | null = null

  const flush = () => {
    if (!current) return
    if (!current.method) {
      current = null
      return
    }
    requests.push({
      id: `req-${requests.length}`,
      name: current.name || `${current.method} ${shortUrl(current.url)}`,
      method: current.method,
      url: current.url,
      headers: current.headers,
      // Trailing blank lines are formatting, not payload.
      body: current.bodyLines.join('\n').replace(/\s+$/, ''),
      line: current.line,
    })
    current = null
  }

  let pendingName = ''

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trim()

    // A separator ends the previous request and may name the next.
    if (line.startsWith('###')) {
      flush()
      pendingName = line.replace(/^#+/, '').trim()
      continue
    }

    // Comments, but only outside a body — `#` is valid JSON string content.
    if (!current?.inBody && (line.startsWith('//') || (line.startsWith('#') && !line.startsWith('###')))) {
      continue
    }

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
        name: pendingName,
        line: i + 1,
        method: parsed.method,
        url: parsed.url,
        headers: [],
        bodyLines: [],
        inBody: false,
      }
      pendingName = ''
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

function parseRequestLine(line: string): { method: string; url: string } | null {
  const parts = line.split(/\s+/)
  if (parts.length >= 2 && METHODS.has(parts[0].toUpperCase())) {
    // Drop a trailing HTTP/1.1 if present.
    const url = parts.slice(1).filter((p) => !/^HTTP\/[\d.]+$/i.test(p)).join(' ')
    return { method: parts[0].toUpperCase(), url }
  }
  // A bare URL is a GET, which is what both reference implementations do.
  if (parts.length === 1 && /^(https?:\/\/|\{\{)/.test(parts[0])) {
    return { method: 'GET', url: parts[0] }
  }
  return null
}

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

function shortUrl(url: string): string {
  return url.length > 60 ? `${url.slice(0, 57)}…` : url
}
