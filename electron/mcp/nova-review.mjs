/**
 * The MCP server that lets an assistant look at the app it is editing.
 *
 * Spawned by the vendor's CLI, not by Nova, so it has no IPC channel home —
 * it reaches the editor over the loopback bridge whose address and token Nova
 * puts in its environment. Everything here is forwarding and framing; the tools
 * themselves are implemented in the main process, where the browser pane and
 * the device tooling live.
 *
 * Plain `.mjs` with no dependencies, and no SDK. MCP over stdio is newline-free
 * JSON-RPC 2.0 on stdin and stdout, which is about forty lines to do properly —
 * less than the cost of keeping a dependency working inside a packaged app.
 *
 * Nothing may be written to stdout that is not a response: stdout *is* the
 * protocol. Diagnostics go to stderr, which the CLI shows the user.
 */

const BRIDGE = process.env.NOVA_REVIEW_URL
const TOKEN = process.env.NOVA_REVIEW_TOKEN

const TOOLS = [
  {
    name: 'open_app',
    description:
      "Open a URL in the editor's built-in browser pane. Use this to look at the running app — start its dev server first if it is not already running. The pane stays on that page, so a screenshot afterwards shows it.",
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'An http or https URL.' } },
      required: ['url'],
    },
  },
  {
    name: 'screenshot_app',
    description:
      'Capture whatever the browser pane is currently showing. Returns a PNG path relative to the project; read that file to actually see the page. Use it to check a change you just made, or to see what a bug looks like.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'read_console',
    description:
      'Recent console output from the page in the browser pane, newest last. Errors and warnings from the running app appear here — check it after loading a page that misbehaves.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many lines. Default 100.' } },
    },
  },
  {
    name: 'list_run_configs',
    description:
      "The project's detected run configurations, with the command each one runs. Use this to find out how the app is started before asking the user to start it.",
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_devices',
    description:
      'Connected and bootable iOS simulators and Android emulators, with their ids and states.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'launch_on_device',
    description: 'Launch an already-installed app on a simulator or emulator by bundle id.',
    inputSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        bundleId: { type: 'string' },
      },
      required: ['deviceId', 'bundleId'],
    },
  },
]

async function call(tool, args) {
  if (!BRIDGE || !TOKEN) {
    return { error: 'The editor bridge is not configured, so this tool cannot reach Nova.' }
  }
  try {
    const response = await fetch(`${BRIDGE}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ tool, args }),
    })
    if (!response.ok) return { error: `The editor answered ${response.status}.` }
    return await response.json()
  } catch (err) {
    return { error: `Could not reach the editor: ${err.message}` }
  }
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function respond(id, result) {
  // A notification has no id and must not be answered at all.
  if (id === undefined || id === null) return
  write({ jsonrpc: '2.0', id, result })
}

async function handle(request) {
  const { id, method, params } = request

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'nova-review', version: '1.0.0' },
      })
      return

    case 'tools/list':
      respond(id, { tools: TOOLS })
      return

    case 'tools/call': {
      const result = await call(params?.name, params?.arguments ?? {})
      // An error is reported as tool content with `isError`, not as a JSON-RPC
      // error: the model should read it and choose what to do, rather than the
      // CLI treating the whole call as a transport failure.
      respond(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: Boolean(result?.error),
      })
      return
    }

    case 'ping':
      respond(id, {})
      return

    default:
      if (id === undefined || id === null) return
      write({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method ${method}` } })
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  // One JSON object per line. A partial line stays in the buffer until the
  // rest of it arrives.
  for (;;) {
    const newline = buffer.indexOf('\n')
    if (newline === -1) break
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (!line) continue
    let request
    try {
      request = JSON.parse(line)
    } catch {
      process.stderr.write(`nova-review: could not parse a request\n`)
      continue
    }
    void handle(request).catch((err) => {
      process.stderr.write(`nova-review: ${err.message}\n`)
    })
  }
})

process.stdin.on('end', () => process.exit(0))
