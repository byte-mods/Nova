import { ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { TestEvent, TestFrameworkInfo } from '../../shared/types'
import { toolEnv } from '../lib/env'
import {
  detectFrameworks,
  findTestDeclarations,
  FRAMEWORKS,
  type FrameworkContext,
  type TestScope,
} from '../lib/testFrameworks'
import { languageForPath } from '../../shared/languages'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

async function buildContext(root: string): Promise<FrameworkContext> {
  let rootFiles = new Set<string>()
  try {
    rootFiles = new Set(await fs.readdir(root))
  } catch {
    /* unreadable root */
  }
  let packageJson: FrameworkContext['packageJson'] = null
  try {
    packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  } catch {
    /* not a node project */
  }
  return {
    root,
    rootFiles,
    packageJson,
    relative: (file) => path.relative(root, file) || path.basename(file),
  }
}

let current: ChildProcess | null = null

export function registerTestHandlers(ctx: Ctx) {
  ipcMain.handle('tests:detect', async (_e, root: string): Promise<TestFrameworkInfo[]> => {
    const context = await buildContext(root)
    return detectFrameworks(context).map((f) => ({ id: f.id, label: f.label }))
  })

  ipcMain.handle(
    'tests:declarations',
    async (_e, file: string): Promise<{ name: string; line: number }[]> => {
      try {
        const text = await fs.readFile(file, 'utf8')
        return findTestDeclarations(languageForPath(file), text)
      } catch {
        return []
      }
    },
  )

  ipcMain.handle(
    'tests:run',
    async (_e, root: string, frameworkId: string, scope: TestScope) => {
      const runId = `test_${Date.now().toString(36)}`
      const context = await buildContext(root)
      const framework =
        FRAMEWORKS.find((f) => f.id === frameworkId) ?? detectFrameworks(context)[0]

      if (!framework) {
        ctx.broadcast('tests:update', {
          runId,
          framework: '',
          command: '',
          events: [{ type: 'output', text: 'No test framework detected in this project.\n' }],
          done: { exitCode: 1, durationMs: 0 },
        })
        return { runId }
      }

      if (current) current.kill('SIGTERM')

      const { command, args } = framework.command(scope, context)
      const started = Date.now()
      const child = spawn(command, args, {
        cwd: root,
        env: toolEnv({ NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      current = child

      const commandLine = `${command} ${args.join(' ')}`
      const emit = (events: TestEvent[], done?: { exitCode: number | null; durationMs: number }) => {
        if (events.length === 0 && !done) return
        ctx.broadcast('tests:update', {
          runId,
          framework: framework.id,
          command: commandLine,
          events,
          done,
        })
      }

      emit([{ type: 'output', text: `$ ${commandLine}\n` }])

      let full = ''
      let pending = ''
      const consume = (chunk: string) => {
        full += chunk
        pending += chunk
        const events: TestEvent[] = []
        let index: number
        while ((index = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, index)
          pending = pending.slice(index + 1)
          if (framework.parseLine) events.push(...framework.parseLine(line))
          // Go's JSON stream carries its own output events; do not double up.
          if (!framework.parseLine || framework.id !== 'go') {
            events.push({ type: 'output', text: `${line}\n` })
          }
        }
        emit(events)
      }

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', consume)
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', consume)

      child.on('error', (err) => {
        emit(
          [{ type: 'output', text: `${command}: ${err.message}\n` }],
          { exitCode: 127, durationMs: Date.now() - started },
        )
        current = null
      })

      child.on('close', (code) => {
        const tail: TestEvent[] = []
        if (pending.trim()) {
          if (framework.parseLine) tail.push(...framework.parseLine(pending))
          tail.push({ type: 'output', text: pending })
        }
        if (framework.parseFinal) tail.push(...framework.parseFinal(full))
        emit(tail, { exitCode: code, durationMs: Date.now() - started })
        current = null
      })

      return { runId }
    },
  )

  ipcMain.handle('tests:cancel', () => {
    current?.kill('SIGTERM')
    current = null
  })
}
