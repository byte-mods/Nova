/**
 * gRPC: finding out what a server offers, and calling it.
 *
 * Two ways to learn a service exist and both are supported, because in practice
 * you have one or the other and rarely both. A `.proto` file is exact and works
 * offline; server reflection needs nothing but the address, which is what makes
 * it usable against a service someone else deployed. Reflection is tried first
 * when no proto is given, since the alternative is asking the user for a file
 * they may not have.
 *
 * Messages cross the boundary as JSON. protobuf's own JSON mapping is used for
 * the conversion, so a `bytes` field is base64 and an enum is its name — the
 * same text the user would see from `grpcurl`.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import * as grpc from '@grpc/grpc-js'
import type * as pb from 'protobufjs'
import type { GrpcMethod, GrpcServices } from '../../shared/http'
import { isInside, PathEscapeError, resolveInRoot } from './workspacePath'

const load = createRequire(import.meta.url)

/**
 * protobufjs is CommonJS, and an ES module importing it by namespace gets no
 * usable bindings — `protobuf.Root` comes back undefined. Requiring it gives
 * the real `module.exports`, with the typings kept separately as `pb`.
 */
const protobuf = load('protobufjs') as typeof pb

/**
 * The descriptor extension is reached through `require` rather than `import`.
 * It is a CommonJS directory module that builds its exports at load time, so
 * an ESM import of it resolves to nothing useful — and a deep subpath import
 * is not resolvable from an ES module at all. Loading it is also what adds
 * `Root.fromDescriptor`, which is the only way to turn the descriptor bytes a
 * server reflects back into a usable schema.
 */
const descriptor = load('protobufjs/ext/descriptor') as {
  FileDescriptorProto: pb.Type
  FileDescriptorSet: pb.Type
}

/** The extension's addition to Root, which protobufjs's typings do not declare. */
type DescriptorRoot = typeof protobuf.Root & {
  fromDescriptor(descriptorSet: pb.Message | object): pb.Root
}

const JSON_OPTIONS: pb.IConversionOptions = {
  // A 64-bit int does not survive a JS number, so it is rendered as a string —
  // the same choice the canonical protobuf JSON mapping makes.
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
  arrays: true,
  objects: true,
  oneofs: true,
}

/* ---------------- discovery ---------------- */

export async function listServices(
  address: string,
  protoPath: string | undefined,
  baseDir: string,
  projectRoot: string = baseDir,
): Promise<GrpcServices> {
  if (protoPath) {
    try {
      const root = await loadProto(protoPath, baseDir, projectRoot)
      return { source: 'proto', methods: collectMethods(root) }
    } catch (err) {
      return { source: 'proto', methods: [], error: (err as Error).message }
    }
  }

  try {
    const root = await loadByReflection(address)
    return { source: 'reflection', methods: collectMethods(root) }
  } catch (err) {
    return {
      source: 'reflection',
      methods: [],
      error: `${(err as Error).message} — add \`# @proto ./service.proto\` if the server has reflection disabled.`,
    }
  }
}

async function loadProto(protoPath: string, baseDir: string, projectRoot: string): Promise<pb.Root> {
  const file = await resolveInRoot(projectRoot, protoPath, { base: baseDir }).catch((err) => {
    if (err instanceof PathEscapeError) {
      throw new Error(`The proto file ${protoPath} is outside the open project.`)
    }
    throw err
  })
  try {
    await fs.access(file)
  } catch {
    throw new Error(`No such proto file: ${protoPath}`)
  }
  const realRoot = await fs.realpath(projectRoot).catch(() => projectRoot)
  const root = new protobuf.Root()
  // Imports are resolved against the proto's own directory first, which is
  // what `protoc -I` would do and what an import of a sibling file expects.
  //
  // An absolute `import` used to be honoured verbatim, which let a `.proto` in
  // a cloned repository pull in any file on the machine. `resolvePath` is sync,
  // so the containment test here is the string one; the entry file above went
  // through the full `realpath` check already.
  root.resolvePath = (origin, target) => {
    const from = origin ? path.dirname(origin) : path.dirname(file)
    const resolved = path.isAbsolute(target) ? target : path.resolve(from, target)
    return isInside(realRoot, resolved) ? resolved : null
  }
  await root.load(file, { keepCase: false })
  return root
}

/**
 * Asks the server to describe itself.
 *
 * Reflection is a bidirectional stream: requests go in, file descriptors come
 * back. The descriptors are protobuf's own wire format for a `.proto` file, so
 * feeding them to `Root.fromDescriptor` yields exactly what parsing the file
 * would have.
 */
async function loadByReflection(address: string): Promise<pb.Root> {
  const { client, close } = openReflection(address)
  try {
    const services = await listServiceNames(client)
    if (!services.length) throw new Error('The server reflected no services.')

    const files: Uint8Array[] = []
    for (const service of services) {
      files.push(...(await describeSymbol(client, service)))
    }
    return rootFromFileDescriptors(files)
  } finally {
    close()
  }
}

interface ReflectionClient {
  makeBidiStreamRequest: grpc.Client['makeBidiStreamRequest']
}

const REFLECTION_PATHS = [
  '/grpc.reflection.v1.ServerReflection/ServerReflectionInfo',
  '/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo',
]

function openReflection(address: string) {
  const client = new grpc.Client(stripScheme(address), credentialsFor(address))
  return { client: client as ReflectionClient, close: () => (client as grpc.Client).close() }
}

/**
 * Reflection messages are hand-encoded rather than loaded from the reflection
 * `.proto`. Only three fields are ever needed, and shipping a copy of that
 * file — plus the loader for it — to read them is more moving parts than the
 * few bytes below.
 */
function encodeReflectionRequest(field: number, value: string): Buffer {
  const payload = Buffer.from(value, 'utf8')
  return Buffer.concat([tag(field, 2), varint(payload.length), payload])
}

function tag(field: number, wireType: number): Buffer {
  return varint((field << 3) | wireType)
}

function varint(value: number): Buffer {
  const bytes: number[] = []
  let remaining = value
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining) byte |= 0x80
    bytes.push(byte)
  } while (remaining)
  return Buffer.from(bytes)
}

/** Walks a serialised message, returning the raw bytes of one field number. */
function readFields(buffer: Buffer, wanted: number): Buffer[] {
  const found: Buffer[] = []
  let offset = 0

  while (offset < buffer.length) {
    const [key, afterKey] = readVarint(buffer, offset)
    if (afterKey < 0) break
    const field = key >>> 3
    const wireType = key & 7
    offset = afterKey

    if (wireType === 2) {
      const [length, afterLength] = readVarint(buffer, offset)
      if (afterLength < 0) break
      offset = afterLength
      if (field === wanted) found.push(buffer.subarray(offset, offset + length))
      offset += length
    } else if (wireType === 0) {
      const [, next] = readVarint(buffer, offset)
      if (next < 0) break
      offset = next
    } else if (wireType === 5) {
      offset += 4
    } else if (wireType === 1) {
      offset += 8
    } else {
      break
    }
  }
  return found
}

function readVarint(buffer: Buffer, offset: number): [number, number] {
  let result = 0
  let shift = 0
  let position = offset
  while (position < buffer.length) {
    const byte = buffer[position++]
    result |= (byte & 0x7f) << shift
    if (!(byte & 0x80)) return [result >>> 0, position]
    shift += 7
    if (shift > 28) break
  }
  return [0, -1]
}

const passthrough = {
  serialize: (value: Buffer) => value,
  deserialize: (value: Buffer) => value,
}

/** `list_services` is field 7; the reply's service list is field 6, name 1. */
function listServiceNames(client: ReflectionClient): Promise<string[]> {
  return reflect(client, encodeReflectionRequest(7, ''), (reply) => {
    const listing = readFields(reply, 6)[0]
    if (!listing) return []
    return readFields(listing, 1)
      .map((entry) => readFields(entry, 1)[0]?.toString('utf8') ?? '')
      .filter((name) => name && !name.startsWith('grpc.reflection.'))
  })
}

/** `file_containing_symbol` is field 4; the reply's descriptors are field 4/1. */
function describeSymbol(client: ReflectionClient, symbol: string): Promise<Uint8Array[]> {
  return reflect(client, encodeReflectionRequest(4, symbol), (reply) => {
    const response = readFields(reply, 4)[0]
    return response ? readFields(response, 1) : []
  })
}

function reflect<T>(
  client: ReflectionClient,
  request: Buffer,
  read: (reply: Buffer) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let call: grpc.ClientDuplexStream<Buffer, Buffer> | null = null
    let lastError: Error | null = null

    const attempt = (index: number) => {
      if (index >= REFLECTION_PATHS.length) {
        return reject(lastError ?? new Error('Server reflection is not available.'))
      }
      call = client.makeBidiStreamRequest(
        REFLECTION_PATHS[index],
        passthrough.serialize,
        passthrough.deserialize,
        new grpc.Metadata(),
      ) as grpc.ClientDuplexStream<Buffer, Buffer>

      let answered = false
      call.on('data', (reply: Buffer) => {
        answered = true
        try {
          resolve(read(reply))
        } catch (err) {
          reject(err as Error)
        }
        call?.end()
      })
      call.on('error', (err: Error) => {
        lastError = err
        // v1 and v1alpha differ only in package name, and which one a server
        // implements is not discoverable — so an UNIMPLEMENTED is a cue to
        // try the other rather than a failure.
        if (!answered) attempt(index + 1)
      })
      call.on('end', () => {
        if (!answered) attempt(index + 1)
      })

      call.write(request)
    }

    attempt(0)
  })
}

/**
 * Rebuilds a protobuf Root from raw FileDescriptorProto bytes.
 *
 * Descriptors arrive per file and repeat — two services in one package pull in
 * the same dependency — so they are de-duplicated by name before being merged,
 * which `fromDescriptor` requires.
 */
function rootFromFileDescriptors(files: Uint8Array[]): pb.Root {
  const seen = new Set<string>()
  const decoded: pb.Message[] = []

  for (const bytes of files) {
    const message = descriptor.FileDescriptorProto.decode(bytes)
    const name = (message as unknown as { name?: string }).name ?? ''
    // One descriptor arrives per file, and files repeat: two services in the
    // same package pull in the same dependency. `fromDescriptor` rejects the
    // duplicate rather than ignoring it.
    if (name && seen.has(name)) continue
    if (name) seen.add(name)
    decoded.push(message)
  }

  const set = descriptor.FileDescriptorSet.fromObject({ file: decoded })
  return (protobuf.Root as DescriptorRoot).fromDescriptor(set)
}

/** Every method in the tree, flattened into something the UI can list. */
function collectMethods(root: pb.Root): GrpcMethod[] {
  const methods: GrpcMethod[] = []

  const walk = (node: pb.NamespaceBase) => {
    for (const child of node.nestedArray) {
      if (child instanceof protobuf.Service) {
        for (const method of child.methodsArray) {
          method.resolve()
          const requestType = method.resolvedRequestType
          methods.push({
            path: `${child.fullName.replace(/^\./, '')}/${method.name}`,
            service: child.fullName.replace(/^\./, ''),
            name: method.name,
            clientStreaming: Boolean(method.requestStream),
            serverStreaming: Boolean(method.responseStream),
            template: requestType ? skeleton(requestType) : '{}',
          })
        }
      }
      if (child instanceof protobuf.Namespace) walk(child)
    }
  }

  walk(root)
  return methods.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * A JSON skeleton of a message, so a user starts from the field names rather
 * than from an empty object. Recursion is capped because message types are
 * routinely self-referential, and a tree type would otherwise not terminate.
 */
function skeleton(type: pb.Type, depth = 0): string {
  return JSON.stringify(skeletonValue(type, depth), null, 2)
}

function skeletonValue(type: pb.Type, depth: number): Record<string, unknown> {
  if (depth > 3) return {}
  const out: Record<string, unknown> = {}

  for (const field of type.fieldsArray) {
    field.resolve()
    let value: unknown

    if (field.resolvedType instanceof protobuf.Enum) {
      value = Object.keys(field.resolvedType.values)[0] ?? ''
    } else if (field.resolvedType instanceof protobuf.Type) {
      value = skeletonValue(field.resolvedType, depth + 1)
    } else {
      value = defaultForScalar(field.type)
    }

    out[field.name] = field.repeated ? [value] : value
  }
  return out
}

function defaultForScalar(type: string): unknown {
  switch (type) {
    case 'string':
    case 'bytes':
      return ''
    case 'bool':
      return false
    case 'double':
    case 'float':
      return 0
    case 'int64':
    case 'uint64':
    case 'sint64':
    case 'fixed64':
    case 'sfixed64':
      // 64-bit values are strings on the wire-to-JSON mapping, and showing a
      // number here would teach the wrong shape.
      return '0'
    default:
      return 0
  }
}

/* ---------------- calling ---------------- */

export interface GrpcCallEvents {
  onMessage: (data: string) => void
  onSystem: (note: string) => void
}

export interface GrpcCallHandle {
  /** Sends another message on a client-streaming call. */
  send: (json: string) => void
  /** Signals the end of the request stream. */
  finish: () => void
  cancel: () => void
  /** Resolves when the call completes, with the trailing status. */
  done: Promise<{ code: number; details: string }>
}

export async function callGrpc(
  address: string,
  methodPath: string,
  protoPath: string | undefined,
  baseDir: string,
  requestJson: string,
  metadata: Record<string, string>,
  timeoutMs: number,
  events: GrpcCallEvents,
  projectRoot: string = baseDir,
): Promise<GrpcCallHandle> {
  const root = protoPath
    ? await loadProto(protoPath, baseDir, projectRoot)
    : await loadByReflection(address)

  const separator = methodPath.lastIndexOf('/')
  if (separator <= 0) {
    throw new Error(`A gRPC method looks like \`package.Service/Method\`, not \`${methodPath}\`.`)
  }
  const serviceName = methodPath.slice(0, separator)
  const methodName = methodPath.slice(separator + 1)

  const service = root.lookupService(serviceName)
  const method = service.methods[methodName]
  if (!method) {
    const available = Object.keys(service.methods).join(', ')
    throw new Error(`${serviceName} has no method ${methodName}. It has: ${available}.`)
  }
  method.resolve()

  const requestType = method.resolvedRequestType!
  const responseType = method.resolvedResponseType!

  const serialize = (value: object) => {
    const error = requestType.verify(value)
    if (error) throw new Error(`Request does not match ${requestType.name}: ${error}`)
    return Buffer.from(requestType.encode(requestType.fromObject(value)).finish())
  }
  const deserialize = (value: Buffer) =>
    responseType.toObject(responseType.decode(value), JSON_OPTIONS)

  const client = new grpc.Client(stripScheme(address), credentialsFor(address))
  const meta = new grpc.Metadata()
  for (const [name, value] of Object.entries(metadata)) meta.set(name, value)
  const options: grpc.CallOptions = { deadline: Date.now() + timeoutMs }

  const fullPath = `/${serviceName}/${methodName}`
  let settle: (result: { code: number; details: string }) => void = () => {}
  const done = new Promise<{ code: number; details: string }>((resolve) => (settle = resolve))

  const parse = (json: string): object => {
    const trimmed = json.trim()
    if (!trimmed) return {}
    try {
      return JSON.parse(trimmed) as object
    } catch (err) {
      throw new Error(`Request body is not valid JSON: ${(err as Error).message}`)
    }
  }

  const onStatus = (status: grpc.StatusObject) => {
    const name = grpc.status[status.code] ?? String(status.code)
    events.onSystem(
      status.code === grpc.status.OK
        ? 'Completed OK'
        : `${name}${status.details ? `: ${status.details}` : ''}`,
    )
    settle({ code: status.code, details: status.details })
    client.close()
  }

  // Unary and server-streaming take their single request now; the two
  // client-streaming shapes stay open for the user to write into.
  if (!method.requestStream && !method.responseStream) {
    const call = client.makeUnaryRequest(
      fullPath,
      serialize,
      deserialize,
      parse(requestJson),
      meta,
      options,
      (error, value) => {
        if (value !== undefined) events.onMessage(JSON.stringify(value, null, 2))
        if (error) onStatus(error as unknown as grpc.StatusObject)
        else onStatus({ code: grpc.status.OK, details: '', metadata: new grpc.Metadata() })
      },
    )
    return handleFor(call, () => {}, done)
  }

  if (!method.requestStream && method.responseStream) {
    const call = client.makeServerStreamRequest(
      fullPath,
      serialize,
      deserialize,
      parse(requestJson),
      meta,
      options,
    )
    call.on('data', (value: unknown) => events.onMessage(JSON.stringify(value, null, 2)))
    call.on('status', onStatus)
    call.on('error', () => undefined)
    return handleFor(call, () => {}, done)
  }

  if (method.requestStream && !method.responseStream) {
    const call = client.makeClientStreamRequest(
      fullPath,
      serialize,
      deserialize,
      meta,
      options,
      (error, value) => {
        if (value !== undefined) events.onMessage(JSON.stringify(value, null, 2))
        if (error) onStatus(error as unknown as grpc.StatusObject)
        else onStatus({ code: grpc.status.OK, details: '', metadata: new grpc.Metadata() })
      },
    )
    if (requestJson.trim()) call.write(parse(requestJson))
    return handleFor(call, (json) => call.write(parse(json)), done, () => call.end())
  }

  const call = client.makeBidiStreamRequest(fullPath, serialize, deserialize, meta, options)
  call.on('data', (value: unknown) => events.onMessage(JSON.stringify(value, null, 2)))
  call.on('status', onStatus)
  call.on('error', () => undefined)
  if (requestJson.trim()) call.write(parse(requestJson))
  return handleFor(call, (json) => call.write(parse(json)), done, () => call.end())
}

function handleFor(
  call: { cancel: () => void },
  send: (json: string) => void,
  done: Promise<{ code: number; details: string }>,
  finish: () => void = () => {},
): GrpcCallHandle {
  return { send, finish, cancel: () => call.cancel(), done }
}

/* ---------------- addresses ---------------- */

/**
 * grpc-js takes `host:port`, not a URL. The scheme is still worth accepting,
 * because it is how a user says whether the connection is encrypted, and
 * copying an address out of a config file usually brings one along.
 */
function stripScheme(address: string): string {
  return address.replace(/^(grpcs?|https?):\/\//, '').replace(/\/+$/, '')
}

function credentialsFor(address: string): grpc.ChannelCredentials {
  const secure = /^(grpcs|https):\/\//.test(address) || /:443$/.test(stripScheme(address))
  return secure ? grpc.credentials.createSsl() : grpc.credentials.createInsecure()
}
