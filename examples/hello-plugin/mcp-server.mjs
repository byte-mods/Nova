#!/usr/bin/env node
/**
 * A minimal MCP server, spoken over stdio.
 *
 * Nova merges this into the config it hands the Claude and Codex CLIs, so the
 * tool below shows up as something the assistant can call while it works on the
 * project. It is written against the wire protocol directly rather than the SDK
 * so the example stays dependency-free — a real plugin would use
 * `@modelcontextprotocol/sdk` and declare it in its own package.json.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const PROTOCOL_VERSION = '2024-11-05'

const TOOLS = [
  {
    name: 'count_files_by_extension',
    description:
      'Counts files in a directory tree, grouped by extension. Use it to get a quick sense of what a project is written in.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Absolute path to scan. Defaults to the plugin working directory.' },
      },
    },
  },
]

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) void handle(line)
  }
})

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`)
}

async function handle(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  const { id, method, params } = message

  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'project-stats', version: '1.0.0' },
      })
      return

    // Notifications carry no id and must not be answered.
    case 'notifications/initialized':
      return

    case 'tools/list':
      reply(id, { tools: TOOLS })
      return

    case 'tools/call': {
      if (params?.name !== 'count_files_by_extension') {
        fail(id, -32601, `Unknown tool: ${params?.name}`)
        return
      }
      try {
        const dir = params.arguments?.directory || process.env.NOVA_PLUGIN_DIR || process.cwd()
        const counts = await countByExtension(dir)
        const text = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([ext, n]) => `${ext}: ${n}`)
          .join('\n')
        reply(id, { content: [{ type: 'text', text: text || 'No files found.' }] })
      } catch (err) {
        reply(id, { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true })
      }
      return
    }

    default:
      if (id !== undefined) fail(id, -32601, `Unknown method: ${method}`)
  }
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.venv', '__pycache__'])

async function countByExtension(dir, counts = {}, depth = 0) {
  if (depth > 12) return counts
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return counts
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.isDirectory()) continue
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await countByExtension(full, counts, depth + 1)
    else {
      const ext = path.extname(entry.name) || '(none)'
      counts[ext] = (counts[ext] ?? 0) + 1
    }
  }
  return counts
}
