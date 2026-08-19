/**
 * Checking a response against the schema its operation declares.
 *
 * This is a **subset** of JSON Schema, and saying so plainly matters more than
 * the coverage does: a validator that silently ignores a keyword it does not
 * know reports "valid" for a document it never really checked, which is worse
 * than not validating at all. Every keyword handled is listed below; anything
 * else is ignored, and `unsupportedKeywords` reports what was skipped so the
 * caller can say so.
 *
 * Supported: `type` (including OpenAPI's `nullable`), `properties`,
 * `required`, `additionalProperties`, `items`, `enum`, `const`, `format`
 * (date-time, date, email, uri, uuid), `minimum`/`maximum`,
 * `minLength`/`maxLength`, `pattern`, `minItems`/`maxItems`, `uniqueItems`,
 * `allOf`, `anyOf`, `oneOf`, `not`, and `$ref` within the same document.
 *
 * Deliberately not supported: `if`/`then`/`else`, `dependentSchemas`,
 * `patternProperties`, `propertyNames`, `contains`, remote `$ref`.
 *
 * ajv is on disk as a transitive dependency and was considered. OpenAPI 3.0
 * schema objects are not valid draft-07 — `nullable` is an extension and
 * `exclusiveMinimum` is a boolean rather than a number — so using it would mean
 * writing and maintaining a conversion layer larger than this file.
 */

export interface Schema {
  [keyword: string]: unknown
}

/** The keywords this validator acts on. Anything else is reported, not obeyed. */
const HANDLED = new Set([
  'type', 'nullable', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'const', 'format', 'minimum', 'maximum', 'exclusiveMinimum',
  'exclusiveMaximum', 'minLength', 'maxLength', 'pattern', 'minItems',
  'maxItems', 'uniqueItems', 'allOf', 'anyOf', 'oneOf', 'not', '$ref',
  // Documentation, not constraints.
  'title', 'description', 'example', 'examples', 'default', 'deprecated',
  'readOnly', 'writeOnly', 'discriminator', 'xml', 'externalDocs',
])

export interface ValidationOutcome {
  errors: string[]
  /** Keywords present in the schema that were not checked. */
  unsupportedKeywords: string[]
}

export function validate(value: unknown, schema: Schema, root: Schema = schema): ValidationOutcome {
  const errors: string[] = []
  const unsupported = new Set<string>()
  check(value, schema, '', errors, root, unsupported, 0)
  return { errors, unsupportedKeywords: [...unsupported].sort() }
}

/** More nesting than this is a `$ref` cycle, not a document. */
const MAX_DEPTH = 64

function check(
  value: unknown,
  schema: Schema | undefined,
  path: string,
  errors: string[],
  root: Schema,
  unsupported: Set<string>,
  depth: number,
) {
  if (!schema || typeof schema !== 'object') return
  if (depth > MAX_DEPTH) {
    errors.push(`${where(path)}: the schema nests too deeply to check — is there a \`$ref\` cycle?`)
    return
  }

  if (typeof schema.$ref === 'string') {
    const resolved = resolveRef(schema.$ref, root)
    if (!resolved) {
      errors.push(`${where(path)}: could not resolve ${schema.$ref}`)
      return
    }
    check(value, resolved, path, errors, root, unsupported, depth + 1)
    return
  }

  for (const keyword of Object.keys(schema)) {
    if (!HANDLED.has(keyword)) unsupported.add(keyword)
  }

  // OpenAPI spells "may be null" as a sibling flag rather than a union type.
  if (value === null) {
    if (schema.nullable === true || typeSet(schema).includes('null')) return
    if (schema.type !== undefined) {
      errors.push(`${where(path)}: expected ${describeType(schema)}, got null`)
    }
    return
  }

  checkType(value, schema, path, errors)
  checkEnum(value, schema, path, errors)
  checkCombinators(value, schema, path, errors, root, unsupported, depth)

  if (typeof value === 'string') checkString(value, schema, path, errors)
  if (typeof value === 'number') checkNumber(value, schema, path, errors)
  if (Array.isArray(value)) checkArray(value, schema, path, errors, root, unsupported, depth)
  else if (isPlainObject(value)) checkObject(value, schema, path, errors, root, unsupported, depth)
}

/* ---------------- type ---------------- */

function checkType(value: unknown, schema: Schema, path: string, errors: string[]) {
  const types = typeSet(schema)
  if (!types.length) return
  if (types.some((type) => matchesType(value, type))) return
  errors.push(`${where(path)}: expected ${describeType(schema)}, got ${actualType(value)}`)
}

function typeSet(schema: Schema): string[] {
  if (typeof schema.type === 'string') return [schema.type]
  if (Array.isArray(schema.type)) return schema.type.filter((t): t is string => typeof t === 'string')
  return []
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    // JSON has one number type, so an integer is a number that happens to be
    // whole — checking `typeof` alone would let 1.5 through as an integer.
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    default:
      return true
  }
}

/* ---------------- scalars ---------------- */

const FORMATS: Record<string, RegExp> = {
  'date-time': /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  uri: /^[A-Za-z][A-Za-z0-9+.-]*:/,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
}

function checkString(value: string, schema: Schema, path: string, errors: string[]) {
  if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
    errors.push(`${where(path)}: shorter than ${schema.minLength} characters`)
  }
  if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    errors.push(`${where(path)}: longer than ${schema.maxLength} characters`)
  }
  if (typeof schema.pattern === 'string') {
    let regex: RegExp | null = null
    try {
      regex = new RegExp(schema.pattern)
    } catch {
      // A pattern the engine cannot compile is a fault in the schema, not the
      // document, and blaming the response for it would send someone hunting
      // in the wrong place.
      errors.push(`${where(path)}: the schema's pattern is not a valid regular expression`)
    }
    if (regex && !regex.test(value)) {
      errors.push(`${where(path)}: does not match ${schema.pattern}`)
    }
  }
  if (typeof schema.format === 'string') {
    const format = FORMATS[schema.format]
    if (format && !format.test(value)) {
      errors.push(`${where(path)}: not a valid ${schema.format}`)
    }
  }
}

function checkNumber(value: number, schema: Schema, path: string, errors: string[]) {
  // OpenAPI 3.0 writes `exclusiveMinimum: true` beside `minimum`; JSON Schema
  // writes `exclusiveMinimum: 5`. Both spellings appear in real specs.
  const exclusiveMin = schema.exclusiveMinimum
  const exclusiveMax = schema.exclusiveMaximum

  if (typeof schema.minimum === 'number') {
    const strict = exclusiveMin === true
    if (strict ? value <= schema.minimum : value < schema.minimum) {
      errors.push(`${where(path)}: ${value} is below the minimum of ${schema.minimum}`)
    }
  }
  if (typeof exclusiveMin === 'number' && value <= exclusiveMin) {
    errors.push(`${where(path)}: ${value} must be greater than ${exclusiveMin}`)
  }
  if (typeof schema.maximum === 'number') {
    const strict = exclusiveMax === true
    if (strict ? value >= schema.maximum : value > schema.maximum) {
      errors.push(`${where(path)}: ${value} is above the maximum of ${schema.maximum}`)
    }
  }
  if (typeof exclusiveMax === 'number' && value >= exclusiveMax) {
    errors.push(`${where(path)}: ${value} must be less than ${exclusiveMax}`)
  }
}

function checkEnum(value: unknown, schema: Schema, path: string, errors: string[]) {
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((allowed) => deepEqual(allowed, value))) {
      errors.push(`${where(path)}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`)
    }
  }
  if ('const' in schema && !deepEqual(schema.const, value)) {
    errors.push(`${where(path)}: expected ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`)
  }
}

/* ---------------- containers ---------------- */

function checkArray(
  value: unknown[],
  schema: Schema,
  path: string,
  errors: string[],
  root: Schema,
  unsupported: Set<string>,
  depth: number,
) {
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
    errors.push(`${where(path)}: has ${value.length} items, needs at least ${schema.minItems}`)
  }
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
    errors.push(`${where(path)}: has ${value.length} items, allows at most ${schema.maxItems}`)
  }
  if (schema.uniqueItems === true) {
    const seen = new Set(value.map((item) => JSON.stringify(item)))
    if (seen.size !== value.length) errors.push(`${where(path)}: contains duplicate items`)
  }
  if (schema.items) {
    value.forEach((item, index) =>
      check(item, schema.items as Schema, `${path}[${index}]`, errors, root, unsupported, depth + 1),
    )
  }
}

function checkObject(
  value: Record<string, unknown>,
  schema: Schema,
  path: string,
  errors: string[],
  root: Schema,
  unsupported: Set<string>,
  depth: number,
) {
  const properties = (schema.properties ?? {}) as Record<string, Schema>

  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (typeof name === 'string' && !(name in value)) {
        errors.push(`${where(join(path, name))}: required, but missing`)
      }
    }
  }

  for (const [name, child] of Object.entries(properties)) {
    if (name in value) check(value[name], child, join(path, name), errors, root, unsupported, depth + 1)
  }

  if (schema.additionalProperties === false) {
    for (const name of Object.keys(value)) {
      if (!(name in properties)) {
        errors.push(`${where(join(path, name))}: not allowed by the schema`)
      }
    }
  } else if (isPlainObject(schema.additionalProperties)) {
    for (const [name, child] of Object.entries(value)) {
      if (name in properties) continue
      check(child, schema.additionalProperties as Schema, join(path, name), errors, root, unsupported, depth + 1)
    }
  }
}

/* ---------------- combinators ---------------- */

function checkCombinators(
  value: unknown,
  schema: Schema,
  path: string,
  errors: string[],
  root: Schema,
  unsupported: Set<string>,
  depth: number,
) {
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) {
      check(value, branch as Schema, path, errors, root, unsupported, depth + 1)
    }
  }

  if (Array.isArray(schema.anyOf)) {
    const matched = schema.anyOf.some((branch) => isValid(value, branch as Schema, root, depth))
    if (!matched) errors.push(`${where(path)}: matches none of the allowed shapes`)
  }

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((branch) => isValid(value, branch as Schema, root, depth)).length
    if (matches === 0) errors.push(`${where(path)}: matches none of the allowed shapes`)
    // `oneOf` means exactly one, and a document matching two is a genuine
    // ambiguity in either the data or the schema.
    else if (matches > 1) errors.push(`${where(path)}: matches ${matches} of the allowed shapes, which must be exactly one`)
  }

  if (isPlainObject(schema.not) && isValid(value, schema.not as Schema, root, depth)) {
    errors.push(`${where(path)}: matches a shape the schema forbids`)
  }
}

function isValid(value: unknown, schema: Schema, root: Schema, depth: number): boolean {
  const errors: string[] = []
  check(value, schema, '', errors, root, new Set(), depth + 1)
  return errors.length === 0
}

/* ---------------- helpers ---------------- */

/** Resolves a local `#/components/schemas/Thing` pointer. */
function resolveRef(ref: string, root: Schema): Schema | null {
  if (!ref.startsWith('#/')) return null
  let cursor: unknown = root
  for (const raw of ref.slice(2).split('/')) {
    // RFC 6901 escapes: `~1` is a slash, `~0` a tilde.
    const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (!isPlainObject(cursor)) return null
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return isPlainObject(cursor) ? (cursor as Schema) : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function join(path: string, name: string): string {
  return path ? `${path}.${name}` : name
}

function where(path: string): string {
  return path ? `\`${path}\`` : 'the response body'
}

function describeType(schema: Schema): string {
  const types = typeSet(schema)
  const rendered = types.length ? types.join(' or ') : 'a value'
  return schema.nullable === true ? `${rendered} or null` : rendered
}

function actualType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') return 'an object'
  return `${typeof value} (${JSON.stringify(value)})`
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
