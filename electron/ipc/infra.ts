/**
 * Docker, Kubernetes and SSH.
 *
 * Read operations run here and return structured rows. Anything interactive —
 * a shell in a container, a log follow, an SSH session — is handed to the
 * terminal instead, because those need a PTY and the user needs to be able to
 * interrupt them.
 *
 * Every command is `execFile` with an argument array. No shell, so a container
 * name with a space or a semicolon in it is a name, not an injection.
 */
import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  DockerContainer,
  DockerImage,
  KubeContext,
  KubeResource,
  SshHost,
  ToolAvailability,
} from '../../shared/infra'
import { toolEnv, which } from '../lib/env'
import { execTool } from '../lib/spawnTool'

const exec = promisify(execFile)

/** These talk to daemons and clusters that may simply be unreachable. */
const COMMAND_TIMEOUT_MS = 30_000

async function run(binary: string, args: string[]): Promise<string> {
  const resolved = await which(binary)
  if (!resolved) throw new Error(`\`${binary}\` is not on PATH.`)
  const { stdout } = await execTool(resolved, args, {
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: 32 * 1024 * 1024,
    env: toolEnv(),
  })
  return stdout
}

export function registerInfraHandlers() {
  ipcMain.handle('infra:available', async (): Promise<ToolAvailability> => {
    const [docker, kubectl, ssh] = await Promise.all([which('docker'), which('kubectl'), which('ssh')])
    return { docker: Boolean(docker), kubectl: Boolean(kubectl), ssh: Boolean(ssh) }
  })

  /* ---------------- Docker ---------------- */

  ipcMain.handle('docker:containers', async (_e, all: boolean): Promise<DockerContainer[]> => {
    // `--format json` gives one JSON object per line, which survives names and
    // port maps containing whitespace far better than parsing the table.
    const args = ['ps', '--format', '{{json .}}']
    if (all) args.push('-a')
    const stdout = await run('docker', args)
    return parseJsonLines(stdout).map((row) => ({
      id: String(row.ID ?? ''),
      name: String(row.Names ?? ''),
      image: String(row.Image ?? ''),
      status: String(row.Status ?? ''),
      state: String(row.State ?? ''),
      ports: String(row.Ports ?? ''),
    }))
  })

  ipcMain.handle('docker:images', async (): Promise<DockerImage[]> => {
    const stdout = await run('docker', ['images', '--format', '{{json .}}'])
    return parseJsonLines(stdout).map((row) => ({
      id: String(row.ID ?? ''),
      repository: String(row.Repository ?? ''),
      tag: String(row.Tag ?? ''),
      size: String(row.Size ?? ''),
      created: String(row.CreatedSince ?? ''),
    }))
  })

  ipcMain.handle('docker:action', async (_e, action: string, id: string): Promise<string> => {
    // An allow-list, not string interpolation: `action` comes from the renderer
    // and must never be able to become an arbitrary docker subcommand.
    const allowed: Record<string, string[]> = {
      start: ['start', id],
      stop: ['stop', id],
      restart: ['restart', id],
      remove: ['rm', '-f', id],
      pause: ['pause', id],
      unpause: ['unpause', id],
    }
    const args = allowed[action]
    if (!args) throw new Error(`Unsupported docker action "${action}".`)
    return run('docker', args)
  })

  ipcMain.handle('docker:inspect', (_e, id: string) => run('docker', ['inspect', id]))

  ipcMain.handle('docker:logs', (_e, id: string, tail = 500) =>
    run('docker', ['logs', '--tail', String(tail), id]),
  )

  /* ---------------- Kubernetes ---------------- */

  ipcMain.handle('kube:contexts', async (): Promise<KubeContext[]> => {
    const stdout = await run('kubectl', [
      'config',
      'get-contexts',
      '-o',
      'name',
    ])
    const names = stdout.split('\n').map((n) => n.trim()).filter(Boolean)
    let current = ''
    try {
      current = (await run('kubectl', ['config', 'current-context'])).trim()
    } catch {
      // No current context set is a normal state, not an error.
    }
    return names.map((name) => ({ name, cluster: '', namespace: '', current: name === current }))
  })

  ipcMain.handle('kube:use', (_e, context: string) =>
    run('kubectl', ['config', 'use-context', context]),
  )

  ipcMain.handle('kube:namespaces', async (): Promise<string[]> => {
    const stdout = await run('kubectl', [
      'get',
      'namespaces',
      '-o',
      'jsonpath={range .items[*]}{.metadata.name}{"\\n"}{end}',
    ])
    return stdout.split('\n').map((n) => n.trim()).filter(Boolean)
  })

  ipcMain.handle(
    'kube:resources',
    async (_e, kind: string, namespace: string): Promise<KubeResource[]> => {
      // Only resource kinds we render columns for; anything else would produce
      // a table this parser silently mangles.
      const allowed = new Set(['pods', 'deployments', 'services', 'nodes', 'statefulsets', 'jobs'])
      if (!allowed.has(kind)) throw new Error(`Unsupported resource kind "${kind}".`)

      const args = ['get', kind, '--no-headers']
      if (kind === 'nodes') args.push('-o', 'wide')
      else if (namespace === '*') args.push('--all-namespaces')
      else if (namespace) args.push('-n', namespace)

      const stdout = await run('kubectl', args)
      const allNamespaces = namespace === '*' && kind !== 'nodes'

      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const cells = line.split(/\s+/)
          // With --all-namespaces the first column is the namespace.
          const ns = allNamespaces ? cells.shift()! : namespace === '*' ? '' : namespace
          const [name, ready, status, restarts, age] = cells
          return {
            kind,
            name: name ?? '',
            namespace: ns ?? '',
            ready: ready ?? '',
            status: status ?? '',
            restarts: restarts ?? '',
            age: age ?? '',
          }
        })
    },
  )

  ipcMain.handle('kube:logs', (_e, pod: string, namespace: string, tail = 500) =>
    run('kubectl', ['logs', pod, ...(namespace ? ['-n', namespace] : []), '--tail', String(tail)]),
  )

  ipcMain.handle('kube:describe', (_e, kind: string, name: string, namespace: string) =>
    run('kubectl', ['describe', kind, name, ...(namespace ? ['-n', namespace] : [])]),
  )

  /* ---------------- SSH ---------------- */

  ipcMain.handle('ssh:hosts', async (): Promise<SshHost[]> => parseSshConfig())
}

/** Parses `--format {{json .}}` output, one object per line. */
function parseJsonLines(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      // A partial line from a truncated buffer; skip it.
    }
  }
  return out
}

/**
 * Reads `~/.ssh/config` for host aliases.
 *
 * Only the fields the UI shows are extracted, and `Host *` is skipped — it is a
 * defaults block, not a machine anyone connects to. `Include` directives are
 * not followed: doing it properly means globbing and recursion, and a host that
 * does not appear is a smaller failure than one that appears wrong.
 */
async function parseSshConfig(): Promise<SshHost[]> {
  const file = path.join(os.homedir(), '.ssh', 'config')
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return []
  }

  const hosts: SshHost[] = []
  let current: SshHost | null = null

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    const match = /^(\w+)\s+(.*)$/.exec(line)
    if (!match) continue
    const keyword = match[1].toLowerCase()
    const value = match[2].trim()

    if (keyword === 'host') {
      if (current) hosts.push(current)
      // A pattern with a wildcard is a defaults block, not a host.
      current = value.includes('*') || value.includes('?')
        ? null
        : { name: value.split(/\s+/)[0], hostname: '', user: '', port: '22', fromConfig: true }
      continue
    }

    if (!current) continue
    if (keyword === 'hostname') current.hostname = value
    else if (keyword === 'user') current.user = value
    else if (keyword === 'port') current.port = value
  }

  if (current) hosts.push(current)
  return hosts.map((host) => ({ ...host, hostname: host.hostname || host.name }))
}
