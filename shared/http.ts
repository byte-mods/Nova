/**
 * The `.http` file format, and the shape of a response.
 *
 * Shared between the parser (main process, so requests can be executed there
 * without CORS) and the view that renders them.
 */

export interface HttpRequest {
  /** Stable within a file: index-based, so edits do not scramble history. */
  id: string
  /** From a `### name` separator, or derived from the URL. */
  name: string
  method: string
  url: string
  headers: { name: string; value: string }[]
  body: string
  /** 1-based line of the request line, for "jump to source". */
  line: number
}

export interface HttpFile {
  requests: HttpRequest[]
  /** Variables declared with `@name = value` at the top of the file. */
  variables: Record<string, string>
  errors: string[]
}

export interface HttpResponse {
  requestId: string
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
}

/** Environments come from `http-client.env.json` beside the `.http` file. */
export type HttpEnvironments = Record<string, Record<string, string>>
