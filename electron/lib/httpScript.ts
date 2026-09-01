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
 * Scripts are code from a `.http` file, and a `.http` file arrives with a
 * cloned repository — so this runs code the user has not read.
 *
 * The context used to be built by handing the script this realm's `Object`,
 * `Array`, `JSON` and friends. That is the textbook `vm` escape: `Object`
 * belongs to the host realm, `Object.constructor` is the host `Function`, and
 * calling it compiles code *here*, next to `safeStorage` and the decrypted API
 * keys. A curated global list does not help, because the leak is the objects
 * themselves rather than which ones they are.
 *
 * So nothing from this realm crosses the boundary now. `vm.createContext`
 * already gives the new context a complete set of its own built-ins, and the
 * whole `nova` API is defined *inside* it by `BOOTSTRAP` below. Data goes in as
 * a JSON literal and comes back as a JSON string, so the only values that cross
 * are primitives. A script that reaches `Object.constructor` now gets the
 * sandbox's own `Function`, which compiles code in a realm with no `process`,
 * no `require` and no bindings.
 *
 * This is a realm boundary, not a process boundary. It closes the escape, and
 * the timeout still stops a `while (true)` from taking the window with it, but
 * a separate process — the one the plugin host already runs in — remains the
 * stronger answer if these scripts ever need to do more than they do today.
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
  const result = runInSandbox(source, {
    mode: 'pre',
    variables,
    request: {
      method: request.method,
      url: request.url,
      headers: { ...request.headers },
      body: request.body,
    },
  })

  // A script that threw before touching the request leaves the request as it
  // was, which is the only safe reading of "it did not finish".
  const edited = result.request ?? request
  return {
    tests: [],
    logs: result.logs,
    variables: result.captured,
    error: result.error,
    request: { url: edited.url, headers: edited.headers, body: edited.body },
  }
}

/** Runs a `> {% %}` block: assertions, and capturing values for later requests. */
export function runPostScript(
  source: string,
  response: HttpResponse,
  variables: Record<string, string>,
): ScriptOutcome {
  const result = runInSandbox(source, {
    mode: 'post',
    variables,
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: lowercaseKeys(response.headers),
      body: response.body,
      contentType: response.contentType,
      time: response.durationMs,
      size: response.size,
    },
  })

  return {
    tests: result.tests,
    logs: result.logs,
    variables: result.captured,
    error: result.error,
  }
}

/* ---------------- the sandbox ---------------- */

/**
 * The whole `nova` API, as source that runs *inside* the context.
 *
 * It is a string rather than the functions it used to be, and that is the
 * point: a function defined in this file is a host-realm object, and one
 * reachable reference is the whole escape. Everything a script can touch is
 * compiled from this text in the sandbox's own realm, closes over nothing from
 * here, and is reachable only through `globalThis.nova`.
 *
 * The seed goes in as `__novaSeed` and the results come back on `__novaOut`,
 * both as plain data.
 */
const BOOTSTRAP = String.raw`
'use strict'
;(function () {
  var seed = globalThis.__novaSeed
  delete globalThis.__novaSeed

  var out = { tests: [], logs: [], captured: {}, request: null }
  globalThis.__novaOut = out

  var variables = seed.variables || {}

  /* How a value appears in a failure message or a log line. */
  function render(value) {
    if (typeof value === 'string') return JSON.stringify(value)
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'object') {
      try {
        var text = JSON.stringify(value)
        if (text === undefined) return String(value)
        /* A whole response body in a failure message buries the failure. */
        return text.length > 200 ? text.slice(0, 200) + '…' : text
      } catch (err) {
        return String(value)
      }
    }
    return String(value)
  }

  function deepEqual(a, b) {
    if (a === b) return true
    if (typeof a !== typeof b || a === null || b === null) return false
    if (typeof a !== 'object') return false

    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
      return a.every(function (item, index) { return deepEqual(item, b[index]) })
    }

    var keys = Object.keys(a)
    if (keys.length !== Object.keys(b).length) return false
    return keys.every(function (key) { return key in b && deepEqual(a[key], b[key]) })
  }

  /* "data.users.0.name" - dotted, with array indices as plain segments. */
  function valueAt(value, path) {
    var cursor = value
    var segments = String(path).split('.')
    for (var i = 0; i < segments.length; i++) {
      if (cursor === null || cursor === undefined) return undefined
      cursor = cursor[segments[i]]
    }
    return cursor
  }

  /* ".not" inverts every matcher, and says so when the inverted check passes. */
  function negate(matchers, actual) {
    var inverted = {}
    Object.keys(matchers).forEach(function (name) {
      if (typeof matchers[name] !== 'function') return
      inverted[name] = function () {
        var args = Array.prototype.slice.call(arguments)
        var threw = false
        try {
          matchers[name].apply(null, args)
        } catch (err) {
          threw = true
        }
        if (!threw) {
          throw new Error(
            'expected ' + render(actual) + ' NOT to ' + name + '(' + args.map(render).join(', ') + ')'
          )
        }
      }
    })
    return inverted
  }

  /*
   * A small matcher set, named after the ones everyone already knows. The
   * failure messages carry both sides, because "expected true, got false" is
   * the single most useless thing an assertion library can say.
   */
  function expectations(actual) {
    function fail(message) { throw new Error(message) }

    /*
     * The matchers are built without "not" on them, and "not" is added after.
     * Enumerating an object to invert it would otherwise evaluate a "not"
     * getter defined alongside them, and invert itself forever.
     */
    var matchers = {
      toBe: function (expected) {
        if (actual !== expected) fail('expected ' + render(expected) + ', got ' + render(actual))
      },
      toEqual: function (expected) {
        if (!deepEqual(actual, expected)) {
          fail('expected ' + render(expected) + ', got ' + render(actual))
        }
      },
      toContain: function (expected) {
        if (typeof actual === 'string') {
          if (actual.indexOf(String(expected)) === -1) {
            fail('expected ' + render(actual) + ' to contain ' + render(expected))
          }
          return
        }
        if (Array.isArray(actual)) {
          var found = actual.some(function (item) { return deepEqual(item, expected) })
          if (!found) fail('expected ' + render(actual) + ' to contain ' + render(expected))
          return
        }
        fail('toContain needs a string or an array, got ' + render(actual))
      },
      toMatch: function (pattern) {
        var regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
        if (typeof actual !== 'string' || !regex.test(actual)) {
          fail('expected ' + render(actual) + ' to match ' + regex)
        }
      },
      toBeGreaterThan: function (expected) {
        if (typeof actual !== 'number' || !(actual > expected)) {
          fail('expected ' + render(actual) + ' to be greater than ' + expected)
        }
      },
      toBeLessThan: function (expected) {
        if (typeof actual !== 'number' || !(actual < expected)) {
          fail('expected ' + render(actual) + ' to be less than ' + expected)
        }
      },
      toBeDefined: function () {
        if (actual === undefined || actual === null) fail('expected a value, got nothing')
      },
      toBeTruthy: function () {
        if (!actual) fail('expected something truthy, got ' + render(actual))
      },
      toHaveLength: function (expected) {
        var length = actual === null || actual === undefined ? undefined : actual.length
        if (length !== expected) fail('expected length ' + expected + ', got ' + render(length))
      },
      toHaveProperty: function (path, expected) {
        var found = valueAt(actual, path)
        if (found === undefined) fail('expected a property "' + path + '", which is not there')
        if (arguments.length > 1 && !deepEqual(found, expected)) {
          fail('expected "' + path + '" to be ' + render(expected) + ', got ' + render(found))
        }
      },
    }

    var api = {}
    Object.keys(matchers).forEach(function (name) { api[name] = matchers[name] })
    Object.defineProperty(api, 'not', {
      get: function () { return negate(matchers, actual) },
    })
    return api
  }

  var vars = {
    get: function (name) {
      var captured = out.captured[name]
      if (captured !== undefined && captured !== null) return captured
      var current = variables[name]
      return current === undefined || current === null ? '' : current
    },
    set: function (name, value) {
      /*
       * Variables are substituted into text, so they are stored as text - a
       * number captured here and interpolated later must round-trip cleanly.
       */
      out.captured[String(name)] = typeof value === 'string' ? value : render(value)
    },
    has: function (name) { return name in out.captured || name in variables },
    all: function () {
      var all = {}
      Object.keys(variables).forEach(function (k) { all[k] = variables[k] })
      Object.keys(out.captured).forEach(function (k) { all[k] = out.captured[k] })
      return all
    },
  }

  var nova = {
    vars: vars,
    env: {
      get: function (name) {
        var value = variables[name]
        return value === undefined || value === null ? '' : value
      },
    },
    log: function () {
      out.logs.push(Array.prototype.slice.call(arguments).map(render).join(' '))
    },
  }

  if (seed.mode === 'pre') {
    /*
     * The script mutates this object directly, which reads better than making
     * it return a new request - nova.request.headers['X-Trace'] = id is the
     * obvious way to write it.
     */
    var headers = {}
    var given = seed.request.headers || {}
    Object.keys(given).forEach(function (k) { headers[k] = given[k] })
    var editable = {
      method: seed.request.method,
      url: seed.request.url,
      headers: headers,
      body: seed.request.body,
    }
    out.request = editable
    nova.request = editable
    /*
     * No tests before a response exists, but the function is present so a
     * shared snippet does not explode when pasted into the wrong block.
     */
    nova.test = function () {
      throw new Error('nova.test is only available in a response script (> {% %}).')
    }
  } else {
    var parsed
    var hasParsed = false
    var parseFailed = false

    nova.response = {
      status: seed.response.status,
      statusText: seed.response.statusText,
      headers: seed.response.headers,
      body: seed.response.body,
      contentType: seed.response.contentType,
      time: seed.response.time,
      size: seed.response.size,
      /*
       * Parsed lazily and once. A script that never calls it should not pay
       * for parsing a large body, and one that calls it in five assertions
       * should not pay five times.
       */
      json: function () {
        if (parseFailed) throw new Error('The response body is not valid JSON.')
        if (!hasParsed) {
          try {
            parsed = JSON.parse(seed.response.body)
            hasParsed = true
          } catch (err) {
            parseFailed = true
            throw new Error('The response body is not valid JSON: ' + err.message)
          }
        }
        return parsed
      },
    }

    /*
     * A failing assertion fails its own test and no others. Without the catch,
     * the first failure would abort the script and hide every check after it -
     * which is exactly when you most want to see the rest.
     */
    nova.test = function (name, fn) {
      var started = Date.now()
      try {
        fn()
        out.tests.push({ name: name, passed: true, durationMs: Date.now() - started })
      } catch (err) {
        out.tests.push({
          name: name,
          passed: false,
          message: err && err.message ? String(err.message) : String(err),
          durationMs: Date.now() - started,
        })
      }
    }

    nova.expect = function (actual) { return expectations(actual) }
  }

  globalThis.nova = nova
  globalThis.console = { log: nova.log, error: nova.log, warn: nova.log }
})()
`

/** What the sandbox is handed. Plain data, serialised in as a JS literal. */
interface Seed {
  mode: 'pre' | 'post'
  variables: Record<string, string>
  request?: RequestFacade
  response?: {
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
    contentType: string
    time: number
    size: number
  }
}

/** What it hands back, read out as a JSON string. */
interface SandboxResult {
  tests: TestResult[]
  logs: string[]
  captured: Record<string, string>
  request: RequestFacade | null
  error?: string
}

/**
 * `JSON.stringify` output is very nearly a JS literal, but not quite: U+2028
 * and U+2029 are legal inside a JSON string and are a line terminator to a JS
 * parser. Escaping them keeps the seed a literal whatever the body contained.
 */
function asJsLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** Whatever a thrown value has to say, without trusting it to be an `Error`. */
function messageOf(err: unknown): string {
  try {
    const message = (err as { message?: unknown } | null)?.message
    if (typeof message === 'string' && message) return message
    return String(err)
  } catch {
    return 'The script failed with an error that could not be read.'
  }
}

function runInSandbox(source: string, seed: Seed): SandboxResult {
  // A fresh context per script: two requests in one file must not be able to
  // leak state through a global, because the order they run in is not
  // something the file's author controls.
  //
  // Contextified from a *null-prototype* object, and nothing is added to it.
  // The new context gets a complete set of its own built-ins either way, so
  // handing it one of this realm's would hand the script a way back out — but
  // `{}` is not empty enough on its own. Node resolves a global lookup through
  // the backing object's prototype chain, so with a plain `{}` the script sees
  // `globalThis.constructor` as *this* realm's `Object`, and
  // `.constructor.constructor` is the host `Function` again. A null prototype
  // is what actually leaves nothing behind the global to find.
  const context = vm.createContext(Object.create(null))
  const empty: SandboxResult = { tests: [], logs: [], captured: {}, request: null }

  try {
    new vm.Script(`globalThis.__novaSeed = ${asJsLiteral(seed)}`, {
      filename: 'nova-seed.js',
    }).runInContext(context, { timeout: SCRIPT_TIMEOUT_MS })
    new vm.Script(BOOTSTRAP, { filename: 'nova-api.js' }).runInContext(context, {
      timeout: SCRIPT_TIMEOUT_MS,
    })
  } catch (err) {
    // The API failing to build is a bug in Nova rather than in the user's
    // script, and saying so is more useful than blaming their file for it.
    return { ...empty, error: `The script API failed to start: ${messageOf(err)}` }
  }

  let error: string | undefined
  try {
    new vm.Script(source, { filename: 'request-script.js' }).runInContext(context, {
      timeout: SCRIPT_TIMEOUT_MS,
    })
  } catch (err) {
    const failure = err as (Error & { code?: string }) | null
    error =
      failure?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT'
        ? `The script did not finish within ${SCRIPT_TIMEOUT_MS / 1000}s.`
        : messageOf(err)
  }

  // Read back as a string, so nothing structured crosses the boundary.
  try {
    const serialised = new vm.Script('JSON.stringify(globalThis.__novaOut)', {
      filename: 'nova-result.js',
    }).runInContext(context, { timeout: SCRIPT_TIMEOUT_MS })
    return { ...empty, ...(JSON.parse(String(serialised)) as SandboxResult), error }
  } catch (err) {
    return { ...empty, error: error ?? `The script result could not be read: ${messageOf(err)}` }
  }
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  // Header names are case-insensitive on the wire, so a script asking for
  // `content-type` must not depend on how the server happened to spell it.
  for (const [name, value] of Object.entries(headers)) out[name.toLowerCase()] = value
  return out
}
