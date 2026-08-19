/**
 * GraphQL: reading a server's schema, and reading its replies properly.
 *
 * Two things make GraphQL different from the REST requests beside it. A server
 * describes itself, so the editor can offer real field names instead of asking
 * the user to remember them; and a failed GraphQL operation still returns 200
 * with an `errors` array, so a client that only looks at the status code
 * reports success on every failure.
 *
 * The introspection query is written out rather than pulled from the `graphql`
 * package: it is a fixed document, the package would be a dependency used for
 * one string, and depth is capped here deliberately — the full recursive type
 * reference of a large schema is megabytes that nothing in the UI reads.
 */
import type { GraphqlField, GraphqlSchema, GraphqlType } from '../../shared/http'
import { applyAuth } from './httpAuth'
import type { AuthScheme } from '../../shared/http'

const INTROSPECTION_QUERY = `
query NovaIntrospection {
  __schema {
    queryType { name }
    mutationType { name }
    subscriptionType { name }
    types {
      kind
      name
      description
      fields(includeDeprecated: false) {
        name
        description
        args { name type { ...TypeRef } }
        type { ...TypeRef }
      }
      inputFields { name type { ...TypeRef } }
      enumValues(includeDeprecated: false) { name description }
    }
  }
}

fragment TypeRef on __Type {
  kind
  name
  ofType {
    kind
    name
    ofType {
      kind
      name
      ofType { kind name }
    }
  }
}
`

interface RawTypeRef {
  kind: string
  name: string | null
  ofType?: RawTypeRef | null
}

interface RawField {
  name: string
  description?: string | null
  type: RawTypeRef
  args?: { name: string; type: RawTypeRef }[]
}

interface RawType {
  kind: string
  name: string | null
  description?: string | null
  fields?: RawField[] | null
  inputFields?: { name: string; type: RawTypeRef }[] | null
  enumValues?: { name: string; description?: string | null }[] | null
}

export async function introspect(
  url: string,
  headers: Record<string, string>,
  auth: AuthScheme,
  timeoutMs = 30_000,
): Promise<GraphqlSchema> {
  const applied = await applyAuth(auth)
  if (applied.error) return { types: [], error: applied.error }

  let target = url
  if (Object.keys(applied.query).length) {
    try {
      const parsed = new URL(url)
      for (const [name, value] of Object.entries(applied.query)) parsed.searchParams.set(name, value)
      target = parsed.toString()
    } catch {
      return { types: [], error: `Not a valid URL: ${url}` }
    }
  }

  let response: Response
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
        ...applied.headers,
      },
      body: JSON.stringify({ query: INTROSPECTION_QUERY }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const error = err as Error
    return {
      types: [],
      error:
        error.name === 'TimeoutError'
          ? `Introspection timed out after ${timeoutMs / 1000}s.`
          : error.message,
    }
  }

  const text = await response.text()
  if (!response.ok) {
    return { types: [], error: `Introspection returned ${response.status}: ${text.slice(0, 300)}` }
  }

  let payload: { data?: { __schema?: unknown }; errors?: unknown }
  try {
    payload = JSON.parse(text)
  } catch {
    return { types: [], error: `Introspection response was not JSON: ${text.slice(0, 300)}` }
  }

  const errors = readErrors(payload)
  if (errors.length) {
    // Servers commonly disable introspection in production, and saying so is
    // more useful than repeating the server's generic field error.
    return { types: [], error: `Introspection was refused: ${errors.join('; ')}` }
  }

  const schema = payload.data?.__schema as
    | {
        queryType?: { name: string } | null
        mutationType?: { name: string } | null
        subscriptionType?: { name: string } | null
        types?: RawType[]
      }
    | undefined
  if (!schema) return { types: [], error: 'The server returned no `__schema`.' }

  return {
    queryType: schema.queryType?.name ?? undefined,
    mutationType: schema.mutationType?.name ?? undefined,
    subscriptionType: schema.subscriptionType?.name ?? undefined,
    types: (schema.types ?? [])
      // Introspection meta-types are part of the protocol, not the API.
      .filter((type) => type.name && !type.name.startsWith('__'))
      .map(toType),
  }
}

function toType(type: RawType): GraphqlType {
  const fields: GraphqlField[] = (type.fields ?? []).map((field) => ({
    name: field.name,
    type: renderTypeRef(field.type),
    description: field.description ?? undefined,
    args: (field.args ?? []).map((arg) => ({ name: arg.name, type: renderTypeRef(arg.type) })),
  }))

  // Input objects and enums have no `fields`, but the members they do have are
  // what a user needs to see, so they are presented the same way.
  for (const input of type.inputFields ?? []) {
    fields.push({ name: input.name, type: renderTypeRef(input.type), args: [] })
  }
  for (const value of type.enumValues ?? []) {
    fields.push({ name: value.name, type: 'enum value', description: value.description ?? undefined, args: [] })
  }

  return {
    name: type.name ?? '(anonymous)',
    kind: type.kind,
    description: type.description ?? undefined,
    fields,
  }
}

/** Renders a nested type reference back into GraphQL's `[Thing!]!` notation. */
function renderTypeRef(ref: RawTypeRef | null | undefined): string {
  if (!ref) return 'Unknown'
  if (ref.kind === 'NON_NULL') return `${renderTypeRef(ref.ofType)}!`
  if (ref.kind === 'LIST') return `[${renderTypeRef(ref.ofType)}]`
  return ref.name ?? 'Unknown'
}

/**
 * Pulls the `errors` array out of a GraphQL reply.
 *
 * Called for every GraphQL response, not just introspection: a 200 with
 * `errors` is the normal way for an operation to fail, and it is the single
 * most common way for a GraphQL client to quietly report success on a failure.
 */
export function readErrors(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const errors = (payload as { errors?: unknown }).errors
  if (!Array.isArray(errors)) return []

  return errors.map((error) => {
    if (typeof error === 'string') return error
    if (error && typeof error === 'object') {
      const record = error as { message?: unknown; path?: unknown }
      const message = typeof record.message === 'string' ? record.message : JSON.stringify(error)
      const where = Array.isArray(record.path) ? ` (at ${record.path.join('.')})` : ''
      return `${message}${where}`
    }
    return String(error)
  })
}

/** Reads the `errors` of a response body, tolerating a non-JSON body. */
export function errorsFromBody(body: string, contentType: string): string[] | undefined {
  if (!contentType.includes('json') && !body.trim().startsWith('{')) return undefined
  try {
    const errors = readErrors(JSON.parse(body))
    return errors.length ? errors : undefined
  } catch {
    return undefined
  }
}
