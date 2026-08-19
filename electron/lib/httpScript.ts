/**
 * The script blocks attached to a request.
 *
 * A request client stops being a toy the moment one request can depend on
 * another — log in, keep the token, use it. That needs somewhere to put a value
 * and somewhere to check one, which is what these scripts are for:
 *
 *   < {% ... %}   before the request, to shape it
 *   > {% ... %}   after the response, to assert on it and capture from it
 *
 * The syntax is IntelliJ's, for the same reason the rest of the format is.
 *
 * Scripts are user code from a file in the user's own project, so this is not a
 * security boundary in the way the plugin host is. It is still run in a `vm`
 * context with nothing but the API below reachable — no `require`, no `process`,
 * no filesystem — because the failure mode being guarded against is a script
 * that wanders off and does something surprising, not a hostile one. The
 * timeout is the part that matters: a `while (true)` in a response handler
 * would otherwise hang the main process and take the window with it.
 */
import vm from 'node:vm'
import type { HttpResponse, TestResult } from '../../shared/http'

/** Long enough for real work, short enough that a runaway loop is noticed. */
const SCRIPT_TIMEOUT_MS = 5_000

export interface ScriptOutcome {
  tests: TestResult[]
  logs: string[]
  /** Variables the script set, to be merged into the run's scope. */
  variables: Record<string, string>
  /** A script that threw — as opposed to an assertion that failed. */
  error?: string
  /** Header and URL changes a pre-request script made. */
  request?: { url: string; headers: Record<string, string>; body: string }
}

export interface RequestFacade {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

/** Runs a `< {% %}` block, which may rewrite the request before it is sent. */
export function runPreScript(
  source: string,
  request: RequestFacade,
  variables: Record<string, string>,
): ScriptOutcome {
  const captured: Record<string, string> = {}
  const logs: string[] = []

  // The script mutates this object directly, which reads better than making it
  // return a new request — `nova.request.headers['X-Trace'] = id` is the
  // obvious way to write it.
  const editable = {
    method: request.method,
    url: request.url,
    headers: { ...request.headers },
    body: request.body,
  }

  const api = {
    request: editable,
    vars: variableApi(variables, captured),
    env: { get: (name: string) => variables[name] ?? '' },
    log: (...args: unknown[]) => logs.push(args.map(render).join(' ')),
    // No tests before a response exists, but the function is present so a
    // shared snippet does not explode when pasted into the wrong block.
    test: () => {
      throw new Error('nova.test is only available in a response script (`> {% %}`).')
    },
  }

  const error = execute(source, api)
  return {
    tests: [],
    logs,
    variables: captured,
    error,
    request: { url: editable.url, headers: editable.headers, body: editable.body },
  }
}

/** Runs a `> {% %}` block: assertions, and capturing values for later requests. */
export function runPostScript(
  source: string,
  response: HttpResponse,
  variables: Record<string, string>,
): ScriptOutcome {
  const captured: Record<string, string> = {}
  const logs: string[] = []
  const tests: TestResult[] = []

  let parsed: unknown
  let parseFailed = false

  const api = {
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: lowercaseKeys(response.headers),
      body: response.body,
      contentType: response.contentType,
      time: response.durationMs,
      size: response.size,
      /**
       * Parsed lazily and once. A script that never calls it should not pay
       * for parsing a large body, and one that calls it in five assertions
       * should not pay five times.
       */
      json: () => {
        if (parseFailed) throw new Error('The response body is not valid JSON.')
        if (parsed === undefined) {
          try {
            parsed = JSON.parse(response.body)
          } catch (err) {
            parseFailed = true
            throw new Error(`The response body is not valid JSON: ${(err as Error).message}`)
          }
        }
        return parsed
      },
    },

    /**
     * A failing assertion fails its own test and no others. Without the catch,
     * the first failure would abort the script and hide every check after it —
     * which is exactly when you most want to see the rest.
     */
    test: (name: string, fn: () => void) => {
      const started = Date.now()
      try {
        fn()
        tests.push({ name, passed: true, durationMs: Date.now() - started })
      } catch (err) {
        tests.push({
          name,
          passed: false,
          message: (err as Error).message,
          durationMs: Date.now() - started,
        })
      }
    },

    expect: (actual: unknown) => expectations(actual),
    vars: variableApi(variables, captured),
    env: { get: (name: string) => variables[name] ?? '' },
    log: (...args: unknown[]) => logs.push(args.map(render).join(' ')),
  }

  const error = execute(source, api)
  return { tests, logs, variables: captured, error }
}

/* ---------------- the sandbox ---------------- */

function execute(source: string, api: Record<string, unknown>): string | undefined {
  // A fresh context per script: two requests in one file must not be able to
  // leak state through a global, because the order they run in is not
  // something the file's author controls.
  const context = vm.createContext({
    nova: api,
    // A deliberately small standard library. Everything here is pure; nothing
    // reaches the filesystem, the network, or the process.
    JSON,
    Math,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    RegExp,
    Error,
    isNaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    console: { log: api.log, error: api.log, warn: api.log },
  })

  try {
    new vm.Script(source, { filename: 'request-script.js' }).runInContext(context, {
      timeout: SCRIPT_TIMEOUT_MS,
    })
    return undefined
  } catch (err) {
    const error = err as Error & { code?: string }
    if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
      return `The script did not finish within ${SCRIPT_TIMEOUT_MS / 1000}s.`
    }
    return error.message
  }
}

function variableApi(current: Record<string, string>, captured: Record<string, string>) {
  return {
    get: (name: string) => captured[name] ?? current[name] ?? '',
    set: (name: string, value: unknown) => {
      // Variables are substituted into text, so they are stored as text — a
      // number captured here and interpolated later must round-trip cleanly.
      captured[String(name)] = typeof value === 'string' ? value : render(value)
    },
    has: (name: string) => name in captured || name in current,
    all: () => ({ ...current, ...captured }),
  }
}

/* ---------------- assertions ---------------- */

/**
 * A small matcher set, named after the ones everyone already knows. The
 * failure messages carry both sides, because "expected true, got false" is the
 * single most useless thing an assertion library can say.
 */
function expectations(actual: unknown) {
  const fail = (message: string): never => {
    throw new Error(message)
  }

  // The matchers are built without `not` on them, and `not` is added after.
  // Enumerating an object to invert it would otherwise evaluate a `not` getter
  // defined alongside them, and invert itself forever.
  const matchers = {
    toBe(expected: unknown) {
      if (actual !== expected) fail(`expected ${render(expected)}, got ${render(actual)}`)
    },
    toEqual(expected: unknown) {
      if (!deepEqual(actual, expected)) {
        fail(`expected ${render(expected)}, got ${render(actual)}`)
      }
    },
    toContain(expected: unknown) {
      if (typeof actual === 'string') {
        if (!actual.includes(String(expected))) {
          fail(`expected ${render(actual)} to contain ${render(expected)}`)
        }
        return
      }
      if (Array.isArray(actual)) {
        if (!actual.some((item) => deepEqual(item, expected))) {
          fail(`expected ${render(actual)} to contain ${render(expected)}`)
        }
        return
      }
      fail(`toContain needs a string or an array, got ${render(actual)}`)
    },
    toMatch(pattern: RegExp | string) {
      const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
      if (typeof actual !== 'string' || !regex.test(actual)) {
        fail(`expected ${render(actual)} to match ${regex}`)
      }
    },
    toBeGreaterThan(expected: number) {
      if (typeof actual !== 'number' || !(actual > expected)) {
        fail(`expected ${render(actual)} to be greater than ${expected}`)
      }
    },
    toBeLessThan(expected: number) {
      if (typeof actual !== 'number' || !(actual < expected)) {
        fail(`expected ${render(actual)} to be less than ${expected}`)
      }
    },
    toBeDefined() {
      if (actual === undefined || actual === null) fail('expected a value, got nothing')
    },
    toBeTruthy() {
      if (!actual) fail(`expected something truthy, got ${render(actual)}`)
    },
    toHaveLength(expected: number) {
      const length = (actual as { length?: number })?.length
      if (length !== expected) fail(`expected length ${expected}, got ${render(length)}`)
    },
    toHaveProperty(path: string, expected?: unknown) {
      const found = valueAt(actual, path)
      if (found === undefined) fail(`expected a property "${path}", which is not there`)
      if (arguments.length > 1 && !deepEqual(found, expected)) {
        fail(`expected "${path}" to be ${render(expected)}, got ${render(found)}`)
      }
    },
  }

  return {
    ...matchers,
    get not(): Record<string, (...args: unknown[]) => void> {
      return negate(matchers as unknown as Record<string, unknown>, actual)
    },
  }
}

/** `.not` inverts every matcher, and says so when the inverted check passes. */
function negate(
  api: Record<string, unknown>,
  actual: unknown,
): Record<string, (...args: unknown[]) => void> {
  const inverted: Record<string, (...args: unknown[]) => void> = {}
  for (const [name, matcher] of Object.entries(api)) {
    if (typeof matcher !== 'function') continue
    inverted[name] = (...args: unknown[]) => {
      let threw = false
      try {
        ;(matcher as (...a: unknown[]) => void)(...args)
      } catch {
        threw = true
      }
      if (!threw) {
        throw new Error(`expected ${render(actual)} NOT to ${name}(${args.map(render).join(', ')})`)
      }
    }
  }
  return inverted
}

/** `data.users.0.name` — dotted, with array indices as plain segments. */
function valueAt(value: unknown, path: string): unknown {
  let cursor = value
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null) return false
  if (typeof a !== 'object') return false

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }

  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => key in right && deepEqual(left[key], right[key]))
}

/** How a value appears in a failure message or a log line. */
function render(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'object') {
    try {
      const text = JSON.stringify(value)
      // A whole response body in a failure message buries the failure.
      return text.length > 200 ? `${text.slice(0, 200)}…` : text
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  // Header names are case-insensitive on the wire, so a script asking for
  // `content-type` must not depend on how the server happened to spell it.
  for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = value
  return out
}
