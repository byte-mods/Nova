/**
 * Running a whole `.http` file: every request in order, with what each one
 * learns available to the next.
 *
 * This is the piece that turns a set of requests into a test suite. Three
 * things make that work, and all three are about state moving forward:
 *
 *   - a run scope, so `nova.vars.set('token', …)` in one response handler is
 *     `{{token}}` in the next request
 *   - assertions collected per request rather than thrown, so one failure does
 *     not hide the twelve checks after it
 *   - a data file, so one request becomes one case per row
 *
 * The same function backs the Run-all button and the CLI runner, because a
 * suite that passes in the editor and fails in CI — or the reverse — is worse
 * than having no CI at all.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  HttpRequest,
  HttpResponse,
  RunResult,
  RunStep,
  TestResult,
} from '../../shared/http'
import { interpolateRequest, parseHttpFile } from './httpFile'
import { sendHttpRequest, type SendContext } from './httpClient'
import { runPostScript, runPreScript } from './httpScript'
import { errorsFromBody } from './graphql'
import { checkContract, loadSpec, type Spec } from './openapi'

export interface RunOptions {
  /** Named environment from `http-client.env.json`, already resolved. */
  environment: Record<string, string>
  context: SendContext
  /** Run only this request, still with the run scope around it. */
  only?: string
  /** Stop at the first request that fails to send or fails a test. */
  bail?: boolean
  /** Checks a response against a contract, when one is configured. */
  validate?: (request: HttpRequest, response: HttpResponse) => string[] | undefined
  onStep?: (step: RunStep) => void
}

export async function runHttpFile(file: string, options: RunOptions): Promise<RunResult> {
  const startedAt = Date.now()
  const result: RunResult = {
    file,
    startedAt,
    durationMs: 0,
    steps: [],
    passed: 0,
    failed: 0,
    variables: {},
  }

  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    result.error = `Could not read ${path.basename(file)}.`
    result.durationMs = Date.now() - startedAt
    return result
  }

  const parsed = parseHttpFile(text)
  const baseDir = path.dirname(file)
  const validate = options.validate ?? (await specValidator(parsed.requests, baseDir))

  // Everything a script captures lands here, and is layered over the
  // environment for every request that follows.
  const runVars: Record<string, string> = {}

  const chosen = options.only
    ? parsed.requests.filter((request) => request.id === options.only)
    : parsed.requests

  for (const request of chosen) {
    // Streaming protocols have no single response to assert on, so a run
    // reports them as skipped rather than pretending or hanging on them.
    if (request.protocol === 'websocket' || request.protocol === 'sse' || request.protocol === 'grpc') {
      const step: RunStep = {
        requestId: request.id,
        name: request.name,
        method: request.method,
        url: request.url,
        protocol: request.protocol,
        status: 0,
        durationMs: 0,
        tests: [],
        logs: [`${request.protocol} is a stream — run it from the panel, not as part of a suite.`],
      }
      result.steps.push(step)
      options.onStep?.(step)
      continue
    }

    const rows = await loadDataRows(request, baseDir)

    for (const [index, row] of rows.entries()) {
      const step = await runOnce(request, {
        ...options,
        validate,
        environment: { ...options.environment, ...runVars, ...row },
        baseDir,
        variables: parsed.variables,
        runVars,
        dataRow: rows.length > 1 || request.dataPath ? index : undefined,
      })

      result.steps.push(step)
      options.onStep?.(step)
      result.passed += step.tests.filter((t) => t.passed).length
      result.failed += step.tests.filter((t) => !t.passed).length

      const broke = Boolean(step.error) || step.tests.some((t) => !t.passed)
      if (options.bail && broke) {
        Object.assign(result.variables, runVars)
        result.durationMs = Date.now() - startedAt
        return result
      }
    }
  }

  Object.assign(result.variables, runVars)
  result.durationMs = Date.now() - startedAt
  return result
}

interface StepOptions extends RunOptions {
  baseDir: string
  variables: Record<string, string>
  runVars: Record<string, string>
  dataRow?: number
}

async function runOnce(request: HttpRequest, options: StepOptions): Promise<RunStep> {
  const filled = interpolateRequest(request, options.variables, options.environment)
  const logs: string[] = []

  const step: RunStep = {
    requestId: request.id,
    name: request.name,
    method: filled.method,
    url: filled.url,
    protocol: filled.protocol,
    status: 0,
    durationMs: 0,
    tests: [],
    logs,
    dataRow: options.dataRow,
  }

  // A data file that could not be read is reported on the step it belongs to,
  // rather than aborting a run of twenty requests for one missing fixture.
  if (options.environment.__dataError) {
    step.error = options.environment.__dataError
    return step
  }

  let toSend = filled

  if (request.preScript) {
    const outcome = runPreScript(
      request.preScript,
      {
        method: filled.method,
        url: filled.url,
        headers: Object.fromEntries(filled.headers.map((h) => [h.name, h.value])),
        body: filled.body.kind === 'text' ? filled.body.text : '',
      },
      options.environment,
    )
    logs.push(...outcome.logs)
    Object.assign(options.runVars, outcome.variables)

    if (outcome.error) {
      // A pre-request script that threw means the request was never shaped as
      // intended, so sending it anyway would test the wrong thing.
      step.error = `Pre-request script failed: ${outcome.error}`
      return step
    }

    if (outcome.request) {
      toSend = {
        ...filled,
        url: outcome.request.url,
        headers: Object.entries(outcome.request.headers).map(([name, value]) => ({ name, value })),
        body:
          filled.body.kind === 'text' || filled.body.kind === 'none'
            ? { kind: 'text', text: outcome.request.body }
            : filled.body,
      }
    }
  }

  const response = await sendHttpRequest(toSend, options.context)
  if (toSend.protocol === 'graphql' && !response.error) {
    response.graphqlErrors = errorsFromBody(response.body, response.contentType)
  }

  step.status = response.status
  step.durationMs = response.durationMs
  step.url = response.sent?.url ?? toSend.url
  if (response.error) step.error = response.error

  const contract = options.validate?.(request, response)
  if (contract?.length) step.contract = contract

  if (request.postScript && !response.error) {
    const outcome = runPostScript(request.postScript, response, options.environment)
    logs.push(...outcome.logs)
    Object.assign(options.runVars, outcome.variables)
    step.tests.push(...outcome.tests)

    if (outcome.error) {
      // A script that threw outside a test block leaves the remaining
      // assertions unrun, which has to be visible rather than counted as a pass.
      step.tests.push({
        name: 'response script',
        passed: false,
        message: outcome.error,
        durationMs: 0,
      })
    }
  }

  // A contract violation is a failure whether or not the file wrote a test for
  // it, so it is reported as one.
  if (step.contract?.length) {
    step.tests.push(
      ...step.contract.map(
        (message): TestResult => ({
          name: 'matches the contract',
          passed: false,
          message,
          durationMs: 0,
        }),
      ),
    )
  }

  return step
}

/* ---------------- contracts ---------------- */

/**
 * Builds the contract check for a run, loading each `# @spec` file once.
 *
 * Loading up front keeps the per-response check synchronous, and means a
 * missing or malformed spec is reported on the first request that wants it
 * rather than re-read for all twenty.
 */
async function specValidator(
  requests: HttpRequest[],
  baseDir: string,
): Promise<RunOptions['validate']> {
  const wanted = [...new Set(requests.map((r) => r.specPath).filter((p): p is string => Boolean(p)))]
  if (!wanted.length) return undefined

  const specs = new Map<string, Spec | string>()
  for (const relative of wanted) {
    try {
      specs.set(relative, await loadSpec(path.resolve(baseDir, relative)))
    } catch (err) {
      specs.set(relative, `Could not read the spec ${relative}: ${(err as Error).message}`)
    }
  }

  return (request, response) => {
    if (!request.specPath) return undefined
    const spec = specs.get(request.specPath)
    if (typeof spec === 'string') return [spec]
    if (!spec) return undefined
    if (response.error) return undefined

    const outcome = checkContract(
      spec,
      request.method,
      response.sent?.url ?? request.url,
      response.status,
      response.body,
      response.contentType,
    )
    return outcome.errors.length ? outcome.errors : undefined
  }
}

/* ---------------- data files ---------------- */

/**
 * The rows a request runs for. Without `# @data` that is one nameless row, so
 * the single-request and data-driven paths are the same loop.
 */
async function loadDataRows(
  request: HttpRequest,
  baseDir: string,
): Promise<Record<string, string>[]> {
  if (!request.dataPath) return [{}]

  const file = path.resolve(baseDir, request.dataPath)
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    // Reported as a row so the failure lands on the step rather than aborting
    // the whole run for one missing fixture.
    return [{ __dataError: `Could not read the data file ${request.dataPath}.` }]
  }

  if (/\.json$/i.test(file)) {
    try {
      const parsed = JSON.parse(text)
      const rows = Array.isArray(parsed) ? parsed : [parsed]
      return rows.map((row) => stringifyValues(row as Record<string, unknown>))
    } catch (err) {
      return [{ __dataError: `${request.dataPath} is not valid JSON: ${(err as Error).message}` }]
    }
  }

  return parseCsv(text)
}

/**
 * A deliberately small CSV reader: comma-separated, `"` for quoting, `""` for
 * a literal quote. Enough for the fixture files these are, and small enough to
 * not need a dependency that would then have to be kept current.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') {
      field += char
    }
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }

  const [header, ...body] = rows.filter((entries) => entries.some((value) => value.trim()))
  if (!header) return []

  const names = header.map((name) => name.trim())
  return body.map((entries) => {
    const record: Record<string, string> = {}
    names.forEach((name, index) => {
      record[name] = (entries[index] ?? '').trim()
    })
    return record
  })
}

/** Variables substitute into text, so every value arrives as text. */
function stringifyValues(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(row ?? {})) {
    out[name] = typeof value === 'string' ? value : JSON.stringify(value)
  }
  return out
}
