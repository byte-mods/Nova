/**
 * The request client's main-process half.
 *
 * Requests execute here rather than in the renderer, so they are not subject to
 * the page's origin policy — an editor that could only call CORS-permissive
 * APIs would be useless for the local backends these files usually point at.
 * It also means a stream survives the panel that displays it re-rendering.
 *
 * gRPC calls are exposed as streams even when they are unary. A unary call is
 * a stream that produces one message, and modelling it that way means the four
 * gRPC shapes, WebSocket and SSE all reach the UI through one channel instead
 * of four.
 */
import { app, ipcMain } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  GraphqlSchema,
  GrpcServices,
  HistoryEntry,
  HttpCollection,
  HttpEnvironments,
  HttpFile,
  HttpRequest,
  HttpResponse,
  MockStatus,
  OpenapiImport,
  RunResult,
  StoredCookie,
  StreamStatus,
} from '../../shared/http'
import { interpolateRequest, parseHttpFile } from '../lib/httpFile'
import { sendHttpRequest } from '../lib/httpClient'
import { CookieJar } from '../lib/cookieJar'
import { HttpHistory } from '../lib/httpHistory'
import { StreamManager } from '../lib/httpStream'
import { errorsFromBody, introspect } from '../lib/graphql'
import { callGrpc, listServices, type GrpcCallHandle } from '../lib/grpcClient'
import { clearTokenCache } from '../lib/httpAuth'
import { runHttpFile } from '../lib/httpRunner'
import { importSpec } from '../lib/openapi'
import { MockServer } from '../lib/mockServer'
import { walk } from '../lib/scan'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

/** Long enough for a cold serverless start, short enough to not hang the UI. */
const REQUEST_TIMEOUT_MS = 60_000
/** Responses larger than this are truncated for display. */
const MAX_BODY_BYTES = 8 * 1024 * 1024
/** A project with more files than this is scanned no further for collections. */
const MAX_SCANNED_FILES = 60_000

const jar = new CookieJar()
const history = new HttpHistory()
const mock = new MockServer()
let projectRoot = ''

/** gRPC calls in flight, keyed by the stream id the renderer knows them by. */
const grpcCalls = new Map<string, GrpcCallHandle>()

export function registerHttpHandlers(ctx: Ctx) {
  const streams = new StreamManager({
    onMessage: (message) => ctx.broadcast('http:streamMessage', message),
    onStatus: (status) => ctx.broadcast('http:streamStatus', status),
  })

  /**
   * Cookies and history are per project: two projects pointing at the same
   * staging host must not see each other's session.
   */
  ipcMain.handle('http:setRoot', async (_e, root: string) => {
    if (root === projectRoot) return
    projectRoot = root
    const dir = path.join(app.getPath('userData'), 'http-client', hash(root))
    await jar.open(dir)
    await history.open(dir)
    clearTokenCache()
  })

  ipcMain.handle('http:parse', async (_e, file: string): Promise<HttpFile> => {
    return parseHttpFile(await fs.readFile(file, 'utf8'))
  })

  /**
   * Reads `http-client.env.json` beside the file, walking up to the project
   * root. IntelliJ looks in the same place, so existing files just work.
   */
  ipcMain.handle('http:environments', async (_e, file: string): Promise<HttpEnvironments> => {
    return (await loadEnvironments(file)) ?? {}
  })

  ipcMain.handle('http:collections', (_e, root: string) => collectRequestFiles(root))

  /* ---------------- one-shot requests ---------------- */

  ipcMain.handle(
    'http:send',
    async (_e, file: string, requestId: string, environment: string | null): Promise<HttpResponse> => {
      const { request, error } = await resolve(file, requestId, environment)
      if (!request) return failed(requestId, error)

      const response = await sendHttpRequest(request, {
        jar,
        baseDir: path.dirname(file),
        defaultTimeoutMs: REQUEST_TIMEOUT_MS,
        maxBodyBytes: MAX_BODY_BYTES,
      })

      // A GraphQL operation that failed still returns 200 with an `errors`
      // array, so a client that only reads the status reports success on
      // every failure. Surfacing it here means every caller gets it.
      if (request.protocol === 'graphql' && !response.error) {
        response.graphqlErrors = errorsFromBody(response.body, response.contentType)
      }

      await history.record(file, request.name, request.url, response)
      return response
    },
  )

  /* ---------------- streams ---------------- */

  ipcMain.handle(
    'http:openStream',
    async (_e, file: string, requestId: string, environment: string | null): Promise<string> => {
      const { request, error } = await resolve(file, requestId, environment)
      if (!request) throw new Error(error)
      return streams.open(request, jar)
    },
  )

  ipcMain.handle('http:sendStream', (_e, streamId: string, data: string) => {
    const call = grpcCalls.get(streamId)
    if (call) {
      call.send(data)
      ctx.broadcast('http:streamMessage', {
        streamId,
        direction: 'out',
        data,
        at: Date.now(),
      })
      return true
    }
    return streams.send(streamId, data)
  })

  ipcMain.handle('http:closeStream', (_e, streamId: string) => {
    const call = grpcCalls.get(streamId)
    // A client-streaming call ends by closing the request side and waiting for
    // the reply, which is different from cancelling it outright.
    if (call) call.finish()
    else streams.close(streamId)
  })

  ipcMain.handle('http:cancelStream', (_e, streamId: string) => {
    grpcCalls.get(streamId)?.cancel()
    streams.close(streamId)
  })

  ipcMain.handle('http:streams', (): StreamStatus[] => streams.list())

  /* ---------------- GraphQL ---------------- */

  ipcMain.handle(
    'http:graphqlSchema',
    async (_e, file: string, requestId: string, environment: string | null): Promise<GraphqlSchema> => {
      const { request, error } = await resolve(file, requestId, environment)
      if (!request) return { types: [], error }

      const headers: Record<string, string> = {}
      for (const header of request.headers) headers[header.name] = header.value
      if (request.useCookies) {
        const cookie = jar.header(request.url)
        if (cookie) headers.Cookie = cookie
      }
      return introspect(request.url, headers, request.auth, request.timeoutMs ?? REQUEST_TIMEOUT_MS)
    },
  )

  /* ---------------- gRPC ---------------- */

  ipcMain.handle(
    'http:grpcServices',
    async (_e, file: string, requestId: string, environment: string | null): Promise<GrpcServices> => {
      const { request, error } = await resolve(file, requestId, environment)
      if (!request) return { source: 'reflection', methods: [], error }
      return listServices(request.url, request.protoPath, path.dirname(file))
    },
  )

  ipcMain.handle(
    'http:grpcCall',
    async (_e, file: string, requestId: string, environment: string | null): Promise<string> => {
      const { request, error } = await resolve(file, requestId, environment)
      if (!request) throw new Error(error)
      if (!request.grpcMethod) {
        throw new Error('This gRPC request has no method — write `GRPC host:port package.Service/Method`.')
      }

      const streamId = `grpc-${crypto.randomUUID()}`
      const status: StreamStatus = {
        streamId,
        requestId,
        protocol: 'grpc',
        state: 'connecting',
        url: `${request.url} ${request.grpcMethod}`,
        received: 0,
        sent: 0,
      }
      ctx.broadcast('http:streamStatus', status)

      const metadata: Record<string, string> = {}
      for (const header of request.headers) metadata[header.name.toLowerCase()] = header.value

      const started = Date.now()
      const emit = (direction: 'in' | 'system', data: string) => {
        if (direction === 'in') status.received++
        ctx.broadcast('http:streamMessage', { streamId, direction, data, at: Date.now() })
      }

      let handle: GrpcCallHandle
      try {
        handle = await callGrpc(
          request.url,
          request.grpcMethod,
          request.protoPath,
          path.dirname(file),
          request.body.kind === 'text' ? request.body.text : '',
          metadata,
          request.timeoutMs ?? REQUEST_TIMEOUT_MS,
          {
            onMessage: (data) => {
              emit('in', data)
              ctx.broadcast('http:streamStatus', { ...status, state: 'open' })
            },
            onSystem: (note) => emit('system', note),
          },
        )
      } catch (err) {
        const message = (err as Error).message
        status.state = 'error'
        status.error = message
        emit('system', message)
        ctx.broadcast('http:streamStatus', { ...status })
        await history.record(file, request.name, request.url, {
          ...failed(requestId, message),
          protocol: 'grpc',
        })
        return streamId
      }

      grpcCalls.set(streamId, handle)
      status.state = 'open'
      ctx.broadcast('http:streamStatus', { ...status })

      void handle.done.then(async (result) => {
        grpcCalls.delete(streamId)
        status.state = result.code === 0 ? 'closed' : 'error'
        if (result.code !== 0) status.error = result.details
        ctx.broadcast('http:streamStatus', { ...status })

        await history.record(file, request.name, request.url, {
          requestId,
          protocol: 'grpc',
          status: result.code,
          statusText: result.details,
          headers: {},
          body: '',
          size: 0,
          contentType: 'application/grpc',
          durationMs: Date.now() - started,
          at: started,
          redirects: [],
          cookies: [],
          error: result.code === 0 ? undefined : result.details || `gRPC status ${result.code}`,
          sent: { method: 'GRPC', url: `${request.url}/${request.grpcMethod}`, headers: metadata, body: '' },
        })
      })

      return streamId
    },
  )

  /* ---------------- runs, contracts and mocks ---------------- */

  /**
   * Runs a whole file — or one request with the run scope around it, so a
   * request that needs a token from an earlier login still works on its own.
   */
  ipcMain.handle(
    'http:run',
    async (
      _e,
      file: string,
      environment: string | null,
      options?: { only?: string; bail?: boolean },
    ): Promise<RunResult> => {
      const environments = environment ? ((await loadEnvironments(file)) ?? {}) : {}
      const values = environment ? (environments[environment] ?? {}) : {}

      const result = await runHttpFile(file, {
        environment: values,
        only: options?.only,
        bail: options?.bail,
        context: {
          jar,
          baseDir: path.dirname(file),
          defaultTimeoutMs: REQUEST_TIMEOUT_MS,
          maxBodyBytes: MAX_BODY_BYTES,
        },
        // Streamed so a long suite fills in as it goes rather than appearing
        // all at once when the last request finishes.
        onStep: (step) => ctx.broadcast('http:runStep', { file, step }),
      })

      ctx.broadcast('http:runDone', result)
      return result
    },
  )

  ipcMain.handle('http:importOpenapi', (_e, specFile: string): Promise<OpenapiImport> =>
    importSpec(specFile),
  )

  ipcMain.handle('http:mockStart', (_e, specFile: string, port?: number): Promise<MockStatus> =>
    mock.start(specFile, port ?? 0),
  )
  ipcMain.handle('http:mockStop', (): Promise<MockStatus> => mock.stop())
  ipcMain.handle('http:mockStatus', (): MockStatus => mock.status())

  /* ---------------- history and cookies ---------------- */

  ipcMain.handle('http:history', (_e, file?: string): HistoryEntry[] => history.list(file))
  ipcMain.handle('http:historyBody', (_e, id: string) => history.body(id))
  ipcMain.handle('http:historyClear', () => history.clear())

  ipcMain.handle('http:cookies', (): StoredCookie[] => jar.all())
  ipcMain.handle('http:clearCookies', (_e, domain?: string) => jar.clear(domain))

  app.on('before-quit', () => {
    streams.closeAll()
    for (const call of grpcCalls.values()) call.cancel()
    grpcCalls.clear()
    void mock.stop()
    // Cookie writes are deliberately off the request path, so the last one may
    // still be in flight when the window closes.
    void jar.flush()
  })
}

/* ---------------- shared plumbing ---------------- */

/**
 * Reads the file, finds the request and fills in every variable it carries.
 *
 * Re-reading rather than trusting a cached parse is deliberate: the file on
 * disk is the source of truth, and running a request that no longer matches
 * what is on screen is the kind of bug that costs an afternoon.
 */
async function resolve(
  file: string,
  requestId: string,
  environment: string | null,
): Promise<{ request?: HttpRequest; error: string }> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return { error: `Could not read ${path.basename(file)}.` }
  }

  const parsed = parseHttpFile(text)
  const request = parsed.requests.find((r) => r.id === requestId)
  if (!request) return { error: `No request "${requestId}" in ${path.basename(file)}.` }

  const environments = environment ? ((await loadEnvironments(file)) ?? {}) : {}
  const values = environment ? (environments[environment] ?? {}) : {}
  return { request: interpolateRequest(request, parsed.variables, values), error: '' }
}

function failed(requestId: string, error: string): HttpResponse {
  return {
    requestId,
    protocol: 'http',
    status: 0,
    statusText: '',
    headers: {},
    body: '',
    size: 0,
    contentType: '',
    durationMs: 0,
    at: Date.now(),
    redirects: [],
    cookies: [],
    error,
  }
}

/**
 * Every `.http` file in the project, as a browsable set of collections. Parse
 * failures are skipped rather than reported: a file being edited is
 * momentarily invalid, and the tree flickering an error is worse than it
 * briefly showing one request fewer.
 */
async function collectRequestFiles(root: string): Promise<HttpCollection[]> {
  if (!root) return []
  const collections: HttpCollection[] = []

  for await (const file of walk(root, MAX_SCANNED_FILES)) {
    if (!/\.(http|rest)$/i.test(file)) continue
    try {
      const parsed = parseHttpFile(await fs.readFile(file, 'utf8'))
      collections.push({
        file,
        relative: path.relative(root, file),
        name: path.basename(file).replace(/\.(http|rest)$/i, ''),
        requests: parsed.requests.map((request) => ({
          id: request.id,
          name: request.name,
          method: request.method,
          protocol: request.protocol,
          line: request.line,
        })),
      })
    } catch {
      // unreadable or mid-edit; skip
    }
  }

  return collections.sort((a, b) => a.relative.localeCompare(b.relative))
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

function hash(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16)
}
