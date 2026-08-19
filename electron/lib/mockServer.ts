/**
 * A mock server, driven by an OpenAPI spec.
 *
 * The point is unblocking: the API is agreed and specified, the backend is
 * three weeks away, and the client cannot be written against nothing. Serving
 * the spec's own examples means the fake and the contract cannot drift apart —
 * when the spec changes, so does the mock, with no second thing to maintain.
 *
 * Responses come from, in order: an `example` on the media type, a named entry
 * under `examples`, or a value generated from the schema. Generating is last
 * because a hand-written example says something a generated one cannot.
 */
import http from 'node:http'
import type { MockStatus } from '../../shared/http'
import { loadSpec, type Spec } from './openapi'
import type { Schema } from './jsonSchema'

export class MockServer {
  private server: http.Server | null = null
  private spec: Spec | null = null
  private specFile = ''
  private port = 0
  private served = 0
  private error = ''

  async start(specFile: string, requestedPort = 0): Promise<MockStatus> {
    await this.stop()
    this.error = ''
    this.served = 0

    try {
      this.spec = await loadSpec(specFile)
      this.specFile = specFile
    } catch (err) {
      this.error = (err as Error).message
      return this.status()
    }

    this.server = http.createServer((req, res) => this.handle(req, res))

    try {
      // Bound to loopback only. A mock built from someone's real spec is not
      // something to expose on the network by accident.
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject)
        this.server!.listen(requestedPort, '127.0.0.1', resolve)
      })
    } catch (err) {
      this.error =
        (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
          ? `Port ${requestedPort} is already in use.`
          : (err as Error).message
      this.server = null
      return this.status()
    }

    const address = this.server.address()
    this.port = typeof address === 'object' && address ? address.port : 0
    return this.status()
  }

  async stop(): Promise<MockStatus> {
    if (this.server) {
      const server = this.server
      this.server = null
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    this.port = 0
    return this.status()
  }

  status(): MockStatus {
    return {
      running: Boolean(this.server),
      port: this.port,
      url: this.port ? `http://127.0.0.1:${this.port}` : '',
      spec: this.specFile,
      served: this.served,
      error: this.error || undefined,
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    this.served++
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const method = (req.method ?? 'GET').toLowerCase()

    // Anything served from a mock is for a client on this machine, so CORS is
    // permissive on purpose — the point is to unblock a browser app.
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    if (method === 'options') {
      res.writeHead(204)
      return res.end()
    }

    const match = this.findOperation(method, url.pathname)
    if (!match) {
      return json(res, 404, {
        error: 'No such operation in the spec',
        path: url.pathname,
        method: method.toUpperCase(),
      })
    }

    // A client can ask for a particular response by status, which is the only
    // way to exercise an error path against a mock.
    const wanted = url.searchParams.get('__status')
    const { status, response } = pickResponse(match.operation, wanted)
    if (!response) return json(res, status, null)

    const media =
      response.content?.['application/json'] ??
      (response.content ? Object.values(response.content)[0] : undefined)
    if (!media) {
      res.writeHead(status)
      return res.end()
    }

    if (media.example !== undefined) return json(res, status, media.example)

    const named = media.examples && Object.values(media.examples)[0]
    if (named && 'value' in named) return json(res, status, named.value)

    return json(res, status, media.schema ? fabricate(media.schema, this.spec!, 0) : null)
  }

  /** Literal segments beat templated ones, as they do in the router being faked. */
  private findOperation(method: string, pathname: string) {
    if (!this.spec) return null
    const segments = trim(pathname).split('/')
    let best: { operation: OperationLike; literals: number } | null = null

    for (const [route, item] of Object.entries(this.spec.paths ?? {})) {
      const operation = item?.[method] as OperationLike | undefined
      if (!operation) continue

      const routeSegments = trim(route).split('/')
      if (routeSegments.length !== segments.length) continue

      let literals = 0
      const matches = routeSegments.every((segment, index) => {
        if (segment.startsWith('{') && segment.endsWith('}')) return true
        literals++
        return segment === segments[index]
      })
      if (!matches) continue
      if (!best || literals > best.literals) best = { operation, literals }
    }

    return best
  }
}

interface OperationLike {
  responses?: Record<string, ResponseLike>
}

interface ResponseLike {
  content?: Record<string, { schema?: Schema; example?: unknown; examples?: Record<string, { value?: unknown }> }>
}

/** The response to serve: the one asked for, else the first success, else any. */
function pickResponse(operation: OperationLike, wanted: string | null) {
  const responses = operation.responses ?? {}

  if (wanted && responses[wanted]) return { status: Number(wanted), response: responses[wanted] }

  const success = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .sort()[0]
  if (success) return { status: Number(success), response: responses[success] }

  const first = Object.keys(responses)[0]
  if (!first) return { status: 200, response: undefined }
  return { status: /^\d+$/.test(first) ? Number(first) : 200, response: responses[first] }
}

/**
 * Builds a plausible value from a schema. Unlike the import's sampler this one
 * fills strings and numbers with something recognisable, because an object of
 * empty strings tells a developer nothing about whether their client works.
 */
function fabricate(schema: Schema | undefined, spec: Spec, depth: number): unknown {
  if (!schema || depth > 5) return null

  if (typeof schema.$ref === 'string') {
    return fabricate(resolve(schema.$ref, spec), spec, depth + 1)
  }
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  if (Array.isArray(schema.allOf)) {
    return Object.assign({}, ...schema.allOf.map((part) => fabricate(part as Schema, spec, depth + 1)))
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return fabricate(schema.oneOf[0] as Schema, spec, depth + 1)
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return fabricate(schema.anyOf[0] as Schema, spec, depth + 1)
  }

  switch (schema.type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [name, child] of Object.entries((schema.properties ?? {}) as Record<string, Schema>)) {
        out[name] = fabricate(child, spec, depth + 1)
      }
      return out
    }
    case 'array':
      return [fabricate(schema.items as Schema, spec, depth + 1)]
    case 'integer':
      return typeof schema.minimum === 'number' ? schema.minimum : 1
    case 'number':
      return typeof schema.minimum === 'number' ? schema.minimum : 1.5
    case 'boolean':
      return true
    case 'string':
      return stringFor(schema)
    default:
      return schema.properties ? fabricate({ ...schema, type: 'object' }, spec, depth) : null
  }
}

function stringFor(schema: Schema): string {
  switch (schema.format) {
    case 'date-time':
      // A fixed instant, so two runs of a mocked client produce the same
      // output and a snapshot test of it does not fail on the clock.
      return '2024-01-01T00:00:00Z'
    case 'date':
      return '2024-01-01'
    case 'email':
      return 'someone@example.com'
    case 'uuid':
      return '00000000-0000-4000-8000-000000000000'
    case 'uri':
      return 'https://example.com'
    default:
      return 'string'
  }
}

function resolve(ref: string, spec: Spec): Schema | undefined {
  if (!ref.startsWith('#/')) return undefined
  let cursor: unknown = spec
  for (const raw of ref.slice(2).split('/')) {
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor as Schema | undefined
}

function json(res: http.ServerResponse, status: number, payload: unknown) {
  const text = JSON.stringify(payload, null, 2)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

function trim(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}
