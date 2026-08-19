import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import grpc from '@grpc/grpc-js'
import protobuf from 'protobufjs'
import { createRequire } from 'node:module'
import { BUILD, TMP } from './env.mjs'

/**
 * gRPC, against a real server.
 *
 * Both discovery routes are exercised, because they fail differently and a
 * user has one or the other: a `.proto` file on disk, and server reflection.
 * The reflection service is implemented here by hand — grpc-js ships no
 * server-side reflection, and the encoding it produces is exactly what the
 * client has to decode, so a stub that agreed with the client would prove
 * nothing.
 */
const descriptorExt = createRequire(import.meta.url)('protobufjs/ext/descriptor')

const { listServices, callGrpc } = await import(pathToFileURL(`${BUILD}/grpcClient.js`).href)

let pass = 0
let fail = 0

function check(label, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`)
  }
}

function equal(label, actual, expected) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(label, a === b, `expected ${b}\n        got      ${a}`)
}

const workspace = path.join(TMP, 'grpc-client')
await fs.rm(workspace, { recursive: true, force: true })
await fs.mkdir(workspace, { recursive: true })

const PROTO = `syntax = "proto3";

package billing;

message Order {
  string id = 1;
  int32 items = 2;
  int64 cents = 3;
  Status status = 4;
}

message Total {
  int64 cents = 1;
  string currency = 2;
}

enum Status {
  PENDING = 0;
  PAID = 1;
}

service Orders {
  rpc Compute (Order) returns (Total);
  rpc Watch (Order) returns (stream Total);
  rpc Collect (stream Order) returns (Total);
}
`

const protoPath = path.join(workspace, 'billing.proto')
await fs.writeFile(protoPath, PROTO)

/* ------------------------------------------------------------------ */
/* server                                                              */
/* ------------------------------------------------------------------ */

const root = await new protobuf.Root().load(protoPath, { keepCase: false })
const Order = root.lookupType('billing.Order')
const Total = root.lookupType('billing.Total')

const encodeTotal = (value) => Buffer.from(Total.encode(Total.fromObject(value)).finish())
const decodeOrder = (buffer) => Order.toObject(Order.decode(buffer), { longs: String, enums: String })

const ordersService = {
  Compute: {
    path: '/billing.Orders/Compute',
    requestStream: false,
    responseStream: false,
    requestSerialize: (v) => Buffer.from(Order.encode(Order.fromObject(v)).finish()),
    requestDeserialize: decodeOrder,
    responseSerialize: encodeTotal,
    responseDeserialize: (b) => Total.toObject(Total.decode(b)),
  },
  Watch: {
    path: '/billing.Orders/Watch',
    requestStream: false,
    responseStream: true,
    requestSerialize: (v) => Buffer.from(Order.encode(Order.fromObject(v)).finish()),
    requestDeserialize: decodeOrder,
    responseSerialize: encodeTotal,
    responseDeserialize: (b) => Total.toObject(Total.decode(b)),
  },
  Collect: {
    path: '/billing.Orders/Collect',
    requestStream: true,
    responseStream: false,
    requestSerialize: (v) => Buffer.from(Order.encode(Order.fromObject(v)).finish()),
    requestDeserialize: decodeOrder,
    responseSerialize: encodeTotal,
    responseDeserialize: (b) => Total.toObject(Total.decode(b)),
  },
}

const server = new grpc.Server()

server.addService(ordersService, {
  Compute(call, callback) {
    if (Number(call.request.items) < 0) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, details: 'items must not be negative' })
    }
    callback(null, { cents: String(Number(call.request.items) * 250), currency: 'GBP' })
  },
  Watch(call) {
    for (let i = 1; i <= 3; i++) call.write({ cents: String(i * 100), currency: 'GBP' })
    call.end()
  },
  Collect(call, callback) {
    let cents = 0
    call.on('data', (order) => {
      cents += Number(order.items) * 250
    })
    call.on('end', () => callback(null, { cents: String(cents), currency: 'GBP' }))
  },
})

addReflection(server, root)

const port = await new Promise((resolve, reject) => {
  server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (err, bound) =>
    err ? reject(err) : resolve(bound),
  )
})
const address = `127.0.0.1:${port}`

/* ------------------------------------------------------------------ */
console.log('\n-- discovery --')
/* ------------------------------------------------------------------ */

{
  const found = await listServices(address, './billing.proto', workspace)
  check('loads methods from a proto file', !found.error, found.error)
  equal('reports the source', found.source, 'proto')
  equal(
    'lists every method',
    found.methods.map((m) => m.path),
    ['billing.Orders/Collect', 'billing.Orders/Compute', 'billing.Orders/Watch'],
  )
  equal(
    'marks which side streams',
    found.methods.map((m) => [m.name, m.clientStreaming, m.serverStreaming]),
    [
      ['Collect', true, false],
      ['Compute', false, false],
      ['Watch', false, true],
    ],
  )

  const compute = found.methods.find((m) => m.name === 'Compute')
  const template = JSON.parse(compute.template)
  equal('builds a request skeleton from the message', Object.keys(template), ['id', 'items', 'cents', 'status'])
  // 64-bit fields do not survive a JS number, so the skeleton must teach the
  // string form the wire mapping actually uses.
  equal('renders a 64-bit field as a string', template.cents, '0')
  equal('renders an enum by name', template.status, 'PENDING')
}

{
  const found = await listServices(address, undefined, workspace)
  check('discovers methods by server reflection', !found.error, found.error)
  equal('reports reflection as the source', found.source, 'reflection')
  check(
    'reflection finds the same methods',
    found.methods.map((m) => m.path).join(',') ===
      'billing.Orders/Collect,billing.Orders/Compute,billing.Orders/Watch',
    found.methods.map((m) => m.path).join(','),
  )
}

{
  const found = await listServices(address, './nope.proto', workspace)
  check('reports a missing proto file', /No such proto file/.test(found.error ?? ''), found.error)
}

/* ------------------------------------------------------------------ */
console.log('\n-- calling --')
/* ------------------------------------------------------------------ */

/** Runs a call to completion, collecting messages and the final status. */
async function call(method, body, { send = [], proto = './billing.proto' } = {}) {
  const messages = []
  const notes = []
  const handle = await callGrpc(address, method, proto, workspace, body, {}, 8000, {
    onMessage: (data) => messages.push(data),
    onSystem: (note) => notes.push(note),
  })
  for (const extra of send) handle.send(extra)
  if (send.length) handle.finish()
  const status = await handle.done
  return { messages: messages.map((m) => JSON.parse(m)), notes, status }
}

{
  const { messages, status } = await call('billing.Orders/Compute', '{ "items": 4 }')
  equal('a unary call returns one message', messages.length, 1)
  equal('the reply is decoded to JSON', messages[0], { cents: '1000', currency: 'GBP' })
  equal('the call completes OK', status.code, 0)
}

{
  const { messages, status } = await call('billing.Orders/Watch', '{ "items": 1 }')
  equal('a server-streaming call returns every message', messages.map((m) => m.cents), ['100', '200', '300'])
  equal('the stream completes OK', status.code, 0)
}

{
  const { messages, status } = await call('billing.Orders/Collect', '{ "items": 2 }', {
    send: ['{ "items": 3 }', '{ "items": 5 }'],
  })
  equal('a client-streaming call sums everything sent', messages[0].cents, '2500')
  equal('the client stream completes OK', status.code, 0)
}

{
  const { status, notes } = await call('billing.Orders/Compute', '{ "items": -1 }')
  equal('a server error surfaces its status code', status.code, grpc.status.INVALID_ARGUMENT)
  check('the status detail is reported', notes.join(' ').includes('items must not be negative'), notes.join(' '))
}

{
  const { messages } = await call('billing.Orders/Compute', '{ "items": 2 }', { proto: undefined })
  equal('a call works through reflection alone', messages[0], { cents: '500', currency: 'GBP' })
}

{
  let error = ''
  try {
    await call('billing.Orders/Nope', '{}')
  } catch (err) {
    error = err.message
  }
  check('an unknown method is rejected with what does exist', /has no method Nope/.test(error), error)
}

{
  let error = ''
  try {
    await call('billing.Orders/Compute', '{ not json }')
  } catch (err) {
    error = err.message
  }
  check('a malformed request body is reported clearly', /not valid JSON/.test(error), error)
}

await new Promise((resolve) => server.tryShutdown(resolve))
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

/* ------------------------------------------------------------------ */
/* a minimal reflection service                                        */
/* ------------------------------------------------------------------ */

/**
 * Answers `list_services` and `file_containing_symbol` with real descriptor
 * bytes, which is all the client asks for. The replies are hand-encoded for
 * the same reason the client hand-decodes them: only a few fields are
 * involved, and loading the reflection `.proto` to reach them would add a
 * dependency to both sides of a test about the wire format.
 */
function addReflection(target, schemaRoot) {
  const definition = {
    ServerReflectionInfo: {
      path: '/grpc.reflection.v1.ServerReflection/ServerReflectionInfo',
      requestStream: true,
      responseStream: true,
      requestSerialize: (v) => v,
      requestDeserialize: (v) => v,
      responseSerialize: (v) => v,
      responseDeserialize: (v) => v,
    },
  }

  const fileDescriptor = Buffer.from(
    descriptorExt.FileDescriptorProto.encode(schemaRoot.toDescriptor('proto3').file[0]).finish(),
  )

  target.addService(definition, {
    ServerReflectionInfo(call) {
      call.on('data', (request) => {
        // Field 7 is list_services; field 4 is file_containing_symbol.
        if (hasField(request, 7)) call.write(listServicesReply(['billing.Orders']))
        else if (hasField(request, 4)) call.write(fileReply([fileDescriptor]))
      })
      call.on('end', () => call.end())
    },
  })
}

function hasField(buffer, wanted) {
  let offset = 0
  while (offset < buffer.length) {
    const [key, next] = readVarint(buffer, offset)
    if (next < 0) return false
    const field = key >>> 3
    const wireType = key & 7
    offset = next
    if (wireType === 2) {
      const [length, afterLength] = readVarint(buffer, offset)
      if (afterLength < 0) return false
      if (field === wanted) return true
      offset = afterLength + length
    } else if (wireType === 0) {
      const [, after] = readVarint(buffer, offset)
      if (after < 0) return false
      if (field === wanted) return true
      offset = after
    } else {
      return false
    }
  }
  return false
}

function readVarint(buffer, offset) {
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

function varint(value) {
  const bytes = []
  let remaining = value
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining) byte |= 0x80
    bytes.push(byte)
  } while (remaining)
  return Buffer.from(bytes)
}

function lengthDelimited(field, payload) {
  return Buffer.concat([varint((field << 3) | 2), varint(payload.length), payload])
}

/** ListServiceResponse is field 6; each Service carries its name in field 1. */
function listServicesReply(names) {
  const services = names.map((name) => lengthDelimited(1, lengthDelimited(1, Buffer.from(name, 'utf8'))))
  return lengthDelimited(6, Buffer.concat(services))
}

/** FileDescriptorResponse is field 4; the descriptors repeat in field 1. */
function fileReply(descriptors) {
  const payload = Buffer.concat(descriptors.map((d) => lengthDelimited(1, d)))
  return lengthDelimited(4, payload)
}
