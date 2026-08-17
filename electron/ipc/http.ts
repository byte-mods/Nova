/**
 * Running requests from `.http` files.
 *
 * Requests execute in the main process rather than the renderer, so they are
 * not subject to the page's origin policy — an editor that could only call
 * CORS-permissive APIs would be useless for the local backends these files
 * usually point at.
 */
import { ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { HttpEnvironments, HttpFile, HttpResponse } from '../../shared/http'
import { interpolate, parseHttpFile } from '../lib/httpFile'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

/** Long enough for a cold serverless start, short enough to not hang the UI. */
const REQUEST_TIMEOUT_MS = 60_000
/** Responses larger than this are truncated for display. */
const MAX_BODY_BYTES = 8 * 1024 * 1024

export function registerHttpHandlers(_ctx: Ctx) {
  ipcMain.handle('http:parse', async (_e, file: string): Promise<HttpFile> => {
    const text = await fs.readFile(file, 'utf8')
    return parseHttpFile(text)
  })

  /**
   * Reads `http-client.env.json` beside the file, walking up to the project
   * root. IntelliJ looks in the same place, so existing files just work.
   */
  ipcMain.handle('http:environments', async (_e, file: string): Promise<HttpEnvironments> => {
    return (await loadEnvironments(file)) ?? {}
  })

  ipcMain.handle(
    'http:send',
    async (_e, file: string, requestId: string, environment: string | null): Promise<HttpResponse> => {
      const text = await fs.readFile(file, 'utf8')
      const parsed = parseHttpFile(text)
      const request = parsed.requests.find((r) => r.id === requestId)
      if (!request) throw new Error(`No request "${requestId}" in ${path.basename(file)}.`)

      const environments = environment ? ((await loadEnvironments(file)) ?? {}) : {}
      const envVars: Record<string, string> = environment ? (environments[environment] ?? {}) : {}

      const url = interpolate(request.url, parsed.variables, envVars)
      const headers: Record<string, string> = {}
      for (const h of request.headers) {
        headers[h.name] = interpolate(h.value, parsed.variables, envVars)
      }
      const body = request.body ? interpolate(request.body, parsed.variables, envVars) : undefined

      const started = Date.now()
      const base: Omit<HttpResponse, 'status' | 'statusText' | 'headers' | 'body' | 'size' | 'contentType'> = {
        requestId,
        durationMs: 0,
        at: started,
      }

      // A leftover placeholder means the request would go somewhere unintended.
      if (/\{\{[A-Za-z0-9_-]+\}\}/.test(url)) {
        return {
          ...base,
          status: 0,
          statusText: '',
          headers: {},
          body: '',
          size: 0,
          contentType: '',
          durationMs: 0,
          error: `Unresolved variable in URL: ${url}. Declare it with \`@name = value\` or pick an environment.`,
        }
      }

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

      try {
        const response = await fetch(url, {
          method: request.method,
          headers,
          body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
          signal: controller.signal,
          redirect: 'follow',
        })

        const buffer = Buffer.from(await response.arrayBuffer())
        const truncated = buffer.length > MAX_BODY_BYTES
        const shown = truncated ? buffer.subarray(0, MAX_BODY_BYTES) : buffer

        const responseHeaders: Record<string, string> = {}
        response.headers.forEach((value, name) => {
          responseHeaders[name] = value
        })

        return {
          ...base,
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          body: shown.toString('utf8') + (truncated ? '\n\n… response truncated for display …' : ''),
          size: buffer.length,
          contentType: response.headers.get('content-type') ?? '',
          durationMs: Date.now() - started,
        }
      } catch (err) {
        const e = err as Error
        return {
          ...base,
          status: 0,
          statusText: '',
          headers: {},
          body: '',
          size: 0,
          contentType: '',
          durationMs: Date.now() - started,
          error: e.name === 'AbortError' ? `Timed out after ${REQUEST_TIMEOUT_MS / 1000}s.` : e.message,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  )
}

async function loadEnvironments(file: string): Promise<HttpEnvironments | null> {
  let dir = path.dirname(file)
  const merged: HttpEnvironments = {}
  let found = false
  for (let depth = 0; depth < 12; depth++) {
    for (const name of ['http-client.env.json', 'http-client.private.env.json']) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as HttpEnvironments
        found = true
        // The private file overlays the shared one, which is how secrets stay
        // out of version control without duplicating every other value.
        for (const [envName, values] of Object.entries(raw)) {
          merged[envName] = { ...(merged[envName] ?? {}), ...values }
        }
      } catch {
        // keep looking
      }
    }
    if (found) return merged
    if (dir === path.dirname(dir)) break
    dir = path.dirname(dir)
  }
  return found ? merged : null
}
