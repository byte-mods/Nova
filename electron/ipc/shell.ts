import { ipcMain } from 'electron'
import { detectRunConfigs, writeSampleRunConfig } from '../lib/runConfigs'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

const CWD_MARKER = '__NOVA_CWD__'

interface Session {
  child: ChildProcess
  id: string
}

const sessions = new Map<string, Session>()
/** Terminal id -> working directory, so `cd` persists between commands. */
const cwds = new Map<string, string>()

function shellEnv(): NodeJS.ProcessEnv {
  const home = os.homedir()
  const extra = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.cargo', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
  const current = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  return {
    ...process.env,
    PATH: [...new Set([...current, ...extra])].join(path.delimiter),
    TERM: 'xterm-256color',
    FORCE_COLOR: '1',
  }
}

export function registerShellHandlers(ctx: Ctx) {
  ipcMain.handle('shell:spawn', async (_e, id: string, cwd: string, command: string) => {
    const existing = sessions.get(id)
    if (existing) existing.child.kill('SIGTERM')

    const workdir = cwds.get(id) ?? cwd
    // The marker lets the renderer keep its prompt in sync when a command cds.
    const script = `cd ${JSON.stringify(workdir)} 2>/dev/null || cd ${JSON.stringify(cwd)}; ${command}\n__code=$?; printf "\\n${CWD_MARKER}%s\\n" "$PWD"; exit $__code`

    const child = spawn(process.env.SHELL || '/bin/zsh', ['-lc', script], {
      cwd: workdir,
      env: shellEnv(),
    })
    sessions.set(id, { child, id })

    const push = (data: string, stream: 'stdout' | 'stderr') => {
      const markerIdx = data.indexOf(CWD_MARKER)
      if (markerIdx !== -1) {
        const rest = data.slice(markerIdx + CWD_MARKER.length).trim()
        if (rest) cwds.set(id, rest.split('\n')[0])
        data = data.slice(0, markerIdx)
      }
      if (data) ctx.broadcast('shell:data', { id, data, stream })
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => push(d, 'stdout'))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (d: string) => push(d, 'stderr'))

    child.on('error', (err) => {
      ctx.broadcast('shell:data', { id, data: `${err.message}\r\n`, stream: 'stderr' })
    })
    child.on('close', (code) => {
      sessions.delete(id)
      ctx.broadcast('shell:exit', { id, code, cwd: cwds.get(id) ?? workdir })
    })
  })

  ipcMain.handle('shell:input', (_e, id: string, data: string) => {
    sessions.get(id)?.child.stdin?.write(data)
  })

  ipcMain.handle('shell:kill', (_e, id: string) => {
    const session = sessions.get(id)
    if (!session) return
    session.child.kill('SIGTERM')
    setTimeout(() => session.child.kill('SIGKILL'), 2000)
  })

  ipcMain.handle('shell:runConfigs', (_e, root: string) => detectRunConfigs(root))
  ipcMain.handle('shell:createRunConfig', (_e, root: string) => writeSampleRunConfig(root))

  ipcMain.handle('shell:detectDevServer', async (_e, root: string) => {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
      const scripts: Record<string, string> = pkg.scripts ?? {}
      const name = ['dev', 'start', 'serve', 'preview'].find((s) => scripts[s])
      if (!name) return null
      const body = scripts[name]
      let port = 3000
      const explicit = body.match(/--port[= ](\d+)/) ?? body.match(/-p[= ](\d+)/)
      if (explicit) port = Number(explicit[1])
      else if (/vite/.test(body)) port = 5173
      else if (/next/.test(body)) port = 3000
      else if (/ng serve/.test(body)) port = 4200
      else if (/react-scripts/.test(body)) port = 3000
      else if (/astro/.test(body)) port = 4321
      else if (/nuxt/.test(body)) port = 3000
      const manager = await detectPackageManager(root)
      return { command: `${manager} run ${name}`, url: `http://localhost:${port}` }
    } catch {
      return null
    }
  })
}

async function detectPackageManager(root: string) {
  const checks: [string, string][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
  ]
  for (const [file, manager] of checks) {
    try {
      await fs.access(path.join(root, file))
      return manager
    } catch {
      /* keep looking */
    }
  }
  return 'npm'
}
