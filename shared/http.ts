/**
 * The `.http` file format, and the shape of everything a request can produce.
 *
 * The base syntax is the one IntelliJ and the VS Code REST Client share, which
 * is worth matching exactly — users arrive with files already written against
 * it. Everything beyond plain HTTP is layered on as directives (`# @auth`) and
 * extra verbs (`GRAPHQL`, `GRPC`, `WEBSOCKET`, `SSE`) rather than a new file
 * format, so a file that only does HTTP still opens in any other editor.
 *
 * Shared between the executor (main process, so requests are not subject to
 * the page's origin policy) and the view that renders them.
 */

/** What a request talks. `http` covers plain REST; the rest are extensions. */
export type HttpProtocol = 'http' | 'sse' | 'websocket' | 'graphql' | 'grpc'

/* ---------------- auth ---------------- */

export type AuthScheme =
  | { kind: 'none' }
  | { kind: 'basic'; username: string; password: string }
  | { kind: 'bearer'; token: string }
  | { kind: 'apikey'; in: 'header' | 'query'; name: string; value: string }
  | {
      kind: 'oauth2'
      grant: 'client_credentials' | 'password'
      tokenUrl: string
      clientId: string
      clientSecret: string
      /** Required by the `password` grant, ignored otherwise. */
      username?: string
      password?: string
      scope?: string
      /** Send credentials in the Basic header rather than the form body. */
      clientAuth?: 'header' | 'body'
    }

/* ---------------- bodies ---------------- */

/** One part of a `multipart/form-data` body. */
export interface MultipartPart {
  name: string
  /** Literal content. Mutually exclusive with `filename`. */
  value?: string
  /** Path to read, relative to the `.http` file. Sets the part's filename. */
  filename?: string
  contentType?: string
}

export type HttpBody =
  | { kind: 'none' }
  | { kind: 'text'; text: string }
  /** `< ./payload.json` — the path is relative to the `.http` file. */
  | { kind: 'file'; path: string }
  | { kind: 'multipart'; parts: MultipartPart[] }
  /** GraphQL keeps its query and variables apart so both can be edited. */
  | { kind: 'graphql'; query: string; variables: string; operationName?: string }

/* ---------------- requests ---------------- */

export interface HttpRequest {
  /** Stable within a file: index-based, so edits do not scramble history. */
  id: string
  /** From a `### name` separator, or derived from the URL. */
  name: string
  protocol: HttpProtocol
  /** The HTTP verb. For non-HTTP protocols this is the protocol's own name. */
  method: string
  url: string
  headers: { name: string; value: string }[]
  body: HttpBody
  auth: AuthScheme
  /** 1-based line of the request line, for "jump to source". */
  line: number

  /** Overrides the default timeout for this request only. */
  timeoutMs?: number
  followRedirects: boolean
  /** Whether the project cookie jar is read and written for this request. */
  useCookies: boolean

  /** Runs before the request is sent, and can rewrite it. */
  preScript?: string
  /** Runs after the response arrives: assertions, and capturing variables. */
  postScript?: string
  /** `# @data ./cases.csv` — runs this request once per row. */
  dataPath?: string
  /** `# @spec ./openapi.yaml` — checks the response against its contract. */
  specPath?: string

  /** `pkg.Service/Method`, for gRPC. */
  grpcMethod?: string
  /** A `.proto` file to load, relative to the `.http` file. Else reflection. */
  protoPath?: string
  /** Messages a WebSocket sends as soon as it opens. */
  initialMessages: string[]
}

export interface HttpFile {
  requests: HttpRequest[]
  /** Variables declared with `@name = value` at the top of the file. */
  variables: Record<string, string>
  errors: string[]
}

/** Environments come from `http-client.env.json` beside the `.http` file. */
export type HttpEnvironments = Record<string, Record<string, string>>

/* ---------------- responses ---------------- */

/** One hop of a redirect chain, kept so a 302 loop is visible. */
export interface RedirectHop {
  status: number
  from: string
  to: string
}

export interface HttpResponse {
  requestId: string
  protocol: HttpProtocol
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  /** Milliseconds from send to last byte. */
  durationMs: number
  /** Bytes of the body as received. */
  size: number
  contentType: string
  error?: string
  at: number

  redirects: RedirectHop[]
  /** Cookies the response set, after the jar accepted them. */
  cookies: string[]
  /** GraphQL `errors[]`, which arrive with a 200 and would otherwise be missed. */
  graphqlErrors?: string[]
  /** The request as actually sent, after auth, cookies and interpolation. */
  sent?: { method: string; url: string; headers: Record<string, string>; body: string }
}

/* ---------------- streams ---------------- */

/** A WebSocket, SSE or gRPC-streaming message, in the order it happened. */
export interface StreamMessage {
  streamId: string
  direction: 'in' | 'out' | 'system'
  /** SSE event name, or the WebSocket frame kind. */
  event?: string
  data: string
  at: number
}

export type StreamState = 'connecting' | 'open' | 'closed' | 'error'

export interface StreamStatus {
  streamId: string
  requestId: string
  protocol: HttpProtocol
  state: StreamState
  url: string
  error?: string
  /** Messages received since the stream opened. */
  received: number
  sent: number
}

/* ---------------- GraphQL introspection ---------------- */

export interface GraphqlField {
  name: string
  type: string
  description?: string
  args: { name: string; type: string }[]
}

export interface GraphqlType {
  name: string
  kind: string
  description?: string
  fields: GraphqlField[]
}

export interface GraphqlSchema {
  queryType?: string
  mutationType?: string
  subscriptionType?: string
  types: GraphqlType[]
  error?: string
}

/* ---------------- gRPC discovery ---------------- */

export interface GrpcMethod {
  /** `pkg.Service/Method`, ready to paste into a request line. */
  path: string
  service: string
  name: string
  clientStreaming: boolean
  serverStreaming: boolean
  /** A JSON skeleton of the request message, to start editing from. */
  template: string
}

export interface GrpcServices {
  /** Where the list came from, which changes what a failure means. */
  source: 'reflection' | 'proto'
  methods: GrpcMethod[]
  error?: string
}

/* ---------------- collections and history ---------------- */

/** Every `.http` file in the project, as a browsable tree. */
export interface HttpCollection {
  file: string
  /** Path relative to the project root, for display. */
  relative: string
  name: string
  requests: { id: string; name: string; method: string; protocol: HttpProtocol; line: number }[]
}

export interface HistoryEntry {
  id: string
  file: string
  requestId: string
  name: string
  method: string
  url: string
  protocol: HttpProtocol
  status: number
  durationMs: number
  size: number
  at: number
  error?: string
}

/* ---------------- assertions and runs ---------------- */

/** One `nova.test(...)` block, and whether it held. */
export interface TestResult {
  name: string
  passed: boolean
  /** Why it failed, in the assertion's own words. */
  message?: string
  durationMs: number
}

/** One request's turn in a run: what it sent, what came back, what held. */
export interface RunStep {
  requestId: string
  name: string
  method: string
  url: string
  protocol: HttpProtocol
  status: number
  durationMs: number
  tests: TestResult[]
  /** Set when the request itself failed, as opposed to an assertion. */
  error?: string
  /** Anything the scripts wrote with `nova.log(...)`. */
  logs: string[]
  /** Which row of a `# @data` file this was, when there is one. */
  dataRow?: number
  /** Contract violations, when the request was checked against a schema. */
  contract?: string[]
}

export interface RunResult {
  file: string
  startedAt: number
  durationMs: number
  steps: RunStep[]
  passed: number
  failed: number
  /** Variables the run captured, so the UI can show what chaining produced. */
  variables: Record<string, string>
  /** A run stops here when a request could not be sent at all. */
  error?: string
}

/* ---------------- OpenAPI ---------------- */

export interface OpenapiImport {
  /** The generated `.http` source, ready to write. */
  source: string
  title: string
  operations: number
  /** Servers the spec declares, offered as environments. */
  servers: string[]
  error?: string
}

export interface MockStatus {
  running: boolean
  port: number
  url: string
  spec: string
  /** Requests the mock has answered since it started. */
  served: number
  error?: string
}

/* ---------------- cookies ---------------- */

export interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  /** Epoch millis. Absent for a session cookie. */
  expires?: number
  secure: boolean
  httpOnly: boolean
  sameSite?: string
}
