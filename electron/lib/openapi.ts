/**
 * OpenAPI: turning a spec into requests, and checking responses against it.
 *
 * Importing is the boring half and the useful one — most APIs worth calling
 * already describe themselves, and retyping forty endpoints by hand is how a
 * request file ends up out of date with the service it points at.
 *
 * Validating is the half that finds things. A response can be a perfectly good
 * 200 and still have dropped a field, changed a type, or started returning
 * null where the schema says it never will; nothing about the status code
 * shows that. Checking the body against the operation's own declared schema is
 * a contract test that costs one line in the file.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import type { OpenapiImport } from '../../shared/http'
import { validate, type Schema } from './jsonSchema'

interface Operation {
  method: string
  route: string
  operationId?: string
  summary?: string
  parameters?: Parameter[]
  requestBody?: { content?: Record<string, { schema?: Schema; example?: unknown }> }
  responses?: Record<string, ResponseSpec>
  security?: unknown[]
}

interface Parameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  schema?: Schema
  example?: unknown
}

interface ResponseSpec {
  description?: string
  content?: Record<string, { schema?: Schema; example?: unknown; examples?: Record<string, { value?: unknown }> }>
}

export interface Spec {
  openapi?: string
  swagger?: string
  info?: { title?: string; version?: string }
  servers?: { url?: string }[]
  host?: string
  basePath?: string
  schemes?: string[]
  paths?: Record<string, Record<string, unknown>>
  components?: { schemas?: Record<string, Schema> }
  definitions?: Record<string, Schema>
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

export async function loadSpec(file: string): Promise<Spec> {
  const text = await fs.readFile(file, 'utf8')
  // YAML is a superset of JSON, so one parser reads both — and `.json` files
  // with a stray trailing comma still load, which JSON.parse would refuse.
  const parsed = /\.ya?ml$/i.test(file) ? yaml.load(text) : JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${path.basename(file)} did not contain an object.`)
  }
  return parsed as Spec
}

/* ---------------- import ---------------- */

export async function importSpec(file: string): Promise<OpenapiImport> {
  let spec: Spec
  try {
    spec = await loadSpec(file)
  } catch (err) {
    return { source: '', title: '', operations: 0, servers: [], error: (err as Error).message }
  }

  const operations = collectOperations(spec)
  if (!operations.length) {
    return {
      source: '',
      title: spec.info?.title ?? '',
      operations: 0,
      servers: [],
      error: 'The spec declares no paths.',
    }
  }

  const servers = serverUrls(spec)
  const title = spec.info?.title ?? path.basename(file)

  const lines: string[] = [
    `# ${title}${spec.info?.version ? ` ${spec.info.version}` : ''}`,
    `# Generated from ${path.basename(file)}. Edit freely — this is now yours.`,
    '',
    `@base = ${servers[0] ?? 'http://localhost:8080'}`,
    '',
  ]

  if (servers.length > 1) {
    lines.push('# Other servers the spec declares:', ...servers.slice(1).map((url) => `#   ${url}`), '')
  }

  for (const operation of operations) {
    lines.push(...renderOperation(operation, spec))
  }

  return { source: lines.join('\n'), title, operations: operations.length, servers }
}

function renderOperation(operation: Operation, spec: Spec): string[] {
  const lines: string[] = []
  const name = operation.summary || operation.operationId || `${operation.method} ${operation.route}`
  lines.push(`### ${name}`)

  const parameters = operation.parameters ?? []

  // Path parameters become `{{variables}}`, so a route reads the same way the
  // rest of the file does and can be filled from an environment.
  let route = operation.route
  for (const parameter of parameters.filter((p) => p.in === 'path')) {
    route = route.replace(`{${parameter.name}}`, `{{${parameter.name}}}`)
  }

  const query = parameters
    .filter((p) => p.in === 'query' && p.required)
    .map((p) => `${p.name}=${exampleFor(p)}`)
  const suffix = query.length ? `?${query.join('&')}` : ''

  // Security is described, not guessed: which scheme applies and what the
  // credential is are things only the user knows.
  if (operation.security?.length) {
    lines.push('# @auth bearer {{token}}')
  }

  lines.push(`${operation.method.toUpperCase()} {{base}}${route}${suffix}`)

  for (const header of parameters.filter((p) => p.in === 'header')) {
    lines.push(`${header.name}: ${exampleFor(header)}`)
  }

  const body = requestBodyExample(operation, spec)
  if (body) {
    lines.push('Content-Type: application/json', '', body)
  }

  const success = successStatus(operation)
  if (success) {
    lines.push(
      '',
      '> {%',
      `  nova.test('responds ${success}', () => nova.expect(nova.response.status).toBe(${success}))`,
      '%}',
    )
  }

  lines.push('')
  return lines
}

function collectOperations(spec: Spec): Operation[] {
  const operations: Operation[] = []

  for (const [route, item] of Object.entries(spec.paths ?? {})) {
    if (!item || typeof item !== 'object') continue
    // Parameters declared on the path apply to every method under it.
    const shared = (item.parameters as Parameter[] | undefined) ?? []

    for (const method of METHODS) {
      const operation = item[method] as Operation | undefined
      if (!operation || typeof operation !== 'object') continue
      operations.push({
        ...operation,
        method,
        route,
        parameters: [...shared, ...(operation.parameters ?? [])],
      })
    }
  }

  return operations
}

function serverUrls(spec: Spec): string[] {
  const fromV3 = (spec.servers ?? []).map((server) => server.url).filter((url): url is string => Boolean(url))
  if (fromV3.length) return fromV3

  // Swagger 2 splits the same information across three fields.
  if (spec.host) {
    const scheme = spec.schemes?.[0] ?? 'https'
    return [`${scheme}://${spec.host}${spec.basePath ?? ''}`]
  }
  return []
}

function successStatus(operation: Operation): string | null {
  const codes = Object.keys(operation.responses ?? {})
    .filter((code) => /^2\d\d$/.test(code))
    .sort()
  return codes[0] ?? null
}

function requestBodyExample(operation: Operation, spec: Spec): string | null {
  const content = operation.requestBody?.content
  if (!content) return null
  const json = content['application/json'] ?? Object.values(content)[0]
  if (!json) return null
  if (json.example !== undefined) return JSON.stringify(json.example, null, 2)
  if (!json.schema) return null
  return JSON.stringify(sample(json.schema, spec, 0), null, 2)
}

function exampleFor(parameter: Parameter): string {
  if (parameter.example !== undefined) return String(parameter.example)
  const schema = parameter.schema ?? {}
  if (Array.isArray(schema.enum) && schema.enum.length) return String(schema.enum[0])
  // A placeholder rather than a made-up value: a request that fails because a
  // variable is unset is clearer than one that quietly queries for "string".
  return `{{${parameter.name}}}`
}

/**
 * A representative value for a schema, to start editing from. Capped in depth
 * because schemas are routinely self-referential and a tree type would not
 * terminate.
 */
function sample(schema: Schema | undefined, spec: Spec, depth: number): unknown {
  if (!schema || depth > 4) return null

  if (typeof schema.$ref === 'string') {
    return sample(resolve(schema.$ref, spec), spec, depth + 1)
  }
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0]
  if (Array.isArray(schema.allOf)) {
    return Object.assign({}, ...schema.allOf.map((part) => sample(part as Schema, spec, depth + 1)))
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    return sample(schema.oneOf[0] as Schema, spec, depth + 1)
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
    return sample(schema.anyOf[0] as Schema, spec, depth + 1)
  }

  switch (schema.type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [name, child] of Object.entries((schema.properties ?? {}) as Record<string, Schema>)) {
        out[name] = sample(child, spec, depth + 1)
      }
      return out
    }
    case 'array':
      return [sample(schema.items as Schema, spec, depth + 1)]
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    case 'string':
      return schema.format === 'date-time' ? new Date(0).toISOString() : ''
    default:
      return schema.properties ? sample({ ...schema, type: 'object' }, spec, depth) : null
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

/* ---------------- contract validation ---------------- */

export interface ContractCheck {
  errors: string[]
  /** Set when the spec has no schema for this response at all. */
  note?: string
}

/**
 * Checks a response body against the schema its operation declares.
 *
 * The operation is found by method and by matching the URL's path against the
 * spec's templated routes, so `/users/42` finds `/users/{id}`. A response with
 * no declared schema is reported as unchecked rather than as passing — the
 * difference matters when someone is relying on this to catch a regression.
 */
export function checkContract(
  spec: Spec,
  method: string,
  url: string,
  status: number,
  body: string,
  contentType: string,
): ContractCheck {
  const operation = findOperation(spec, method, url)
  if (!operation) return { errors: [], note: `The spec has no ${method.toUpperCase()} for this path.` }

  const response =
    operation.responses?.[String(status)] ??
    operation.responses?.[`${Math.floor(status / 100)}XX`] ??
    operation.responses?.default
  if (!response) {
    return { errors: [`The spec does not declare a ${status} response for this operation.`] }
  }

  const content = response.content
  if (!content) return { errors: [], note: `The spec declares ${status} with no body schema.` }

  const media = content['application/json'] ?? Object.values(content)[0]
  if (!media?.schema) return { errors: [], note: `The spec declares ${status} with no schema.` }

  if (!contentType.includes('json') && !body.trim().startsWith('{') && !body.trim().startsWith('[')) {
    return { errors: [`Expected a JSON body for ${status}, got ${contentType || 'no content type'}.`] }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (err) {
    return { errors: [`The response body is not valid JSON: ${(err as Error).message}`] }
  }

  const outcome = validate(parsed, media.schema, spec as unknown as Schema)
  const errors = [...outcome.errors]
  if (outcome.unsupportedKeywords.length) {
    // Reported rather than swallowed: a "passed" that skipped half the schema
    // is a false negative someone will build on.
    errors.push(
      `Note: not checked — ${outcome.unsupportedKeywords.join(', ')} (unsupported schema keyword).`,
    )
  }
  return { errors }
}

/**
 * Finds the operation for a concrete URL. Literal segments beat templated ones,
 * so `/users/me` wins over `/users/{id}` when the spec declares both.
 */
function findOperation(spec: Spec, method: string, url: string): Operation | null {
  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }

  const wanted = method.toLowerCase()
  const segments = trim(pathname).split('/')
  let best: { operation: Operation; literals: number } | null = null

  for (const [route, item] of Object.entries(spec.paths ?? {})) {
    const operation = item?.[wanted] as Operation | undefined
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

    if (!best || literals > best.literals) {
      best = {
        operation: { ...operation, method: wanted, route },
        literals,
      }
    }
  }

  return best?.operation ?? null
}

function trim(value: string): string {
  return value.replace(/^\/+|\/+$/g, '')
}
