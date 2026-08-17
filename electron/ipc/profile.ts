/**
 * CPU profiling.
 *
 * Nova does not implement a sampler. It runs the program under the runtime's
 * own profiler — `node --cpu-prof` — and reads the `.cpuprofile` that falls
 * out. That is a deliberate limit: a sampler good enough to trust is a large
 * piece of engineering, and V8 already ships one that is better than anything
 * this could reimplement.
 *
 * The same reader handles a `.cpuprofile` exported from Chrome DevTools, so a
 * profile captured anywhere can be opened here.
 */
import { ipcMain } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { CpuProfile, HotFunction, ProfileFrame } from '../../shared/profile'
import { toolEnv } from '../lib/env'

const exec = promisify(execFile)

/** A profiled run that never ends would fill the disk with samples. */
const PROFILE_TIMEOUT_MS = 5 * 60 * 1000

export function registerProfileHandlers() {
  ipcMain.handle('profile:open', async (_e, file: string): Promise<CpuProfile> => {
    const raw = await fs.readFile(file, 'utf8')
    return parseCpuProfile(raw, file)
  })

  /**
   * Runs a command under `node --cpu-prof` and returns the resulting profile.
   *
   * The profile directory is a fresh temp dir per run so the newest file in it
   * is unambiguously ours — `--cpu-prof-name` exists but is ignored when the
   * process forks, which is exactly when you most want the profile.
   */
  ipcMain.handle(
    'profile:run',
    async (_e, root: string, script: string, args: string[] = []): Promise<CpuProfile> => {
      const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-prof-'))
      try {
        await exec('node', ['--cpu-prof', '--cpu-prof-dir', outDir, script, ...args], {
          cwd: root,
          timeout: PROFILE_TIMEOUT_MS,
          maxBuffer: 64 * 1024 * 1024,
          env: toolEnv(),
        })
      } catch (err) {
        // A non-zero exit still produces a profile, which is often the
        // interesting case — a crash after a slow path. Only give up if nothing
        // was written.
        const e = err as { stderr?: string; message?: string }
        const written = await fs.readdir(outDir).catch(() => [])
        if (!written.length) {
          throw new Error((e.stderr || e.message || 'Profiling run failed.').slice(-4000))
        }
      }

      const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.cpuprofile'))
      if (!files.length) throw new Error('The run produced no .cpuprofile.')

      // With several (worker threads), take the largest — that is the one with
      // the samples that matter.
      let best = path.join(outDir, files[0])
      let bestSize = 0
      for (const name of files) {
        const full = path.join(outDir, name)
        const { size } = await fs.stat(full)
        if (size > bestSize) {
          bestSize = size
          best = full
        }
      }

      return parseCpuProfile(await fs.readFile(best, 'utf8'), best)
    },
  )
}

interface V8Node {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number }
  hitCount?: number
  children?: number[]
}

interface V8Profile {
  nodes: V8Node[]
  startTime: number
  endTime: number
  samples?: number[]
  timeDeltas?: number[]
}

/**
 * Turns V8's flat node list into a call tree with self and total times.
 *
 * V8 gives hit counts, not durations. Multiplying by the average sample
 * interval converts them to milliseconds, which is what the numbers actually
 * mean to a reader — "1,400 samples" is not a unit anyone reasons about.
 */
export function parseCpuProfile(raw: string, source: string): CpuProfile {
  let data: V8Profile
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('That file is not valid JSON, so it is not a .cpuprofile.')
  }
  if (!Array.isArray(data.nodes)) {
    throw new Error('That JSON has no `nodes` array, so it is not a V8 CPU profile.')
  }

  const durationMs = (data.endTime - data.startTime) / 1000
  const totalHits = data.nodes.reduce((sum, node) => sum + (node.hitCount ?? 0), 0)
  // Fall back to treating a hit as a millisecond when the profile has no
  // timestamps, so a malformed export still renders something proportional.
  const msPerHit = totalHits > 0 && durationMs > 0 ? durationMs / totalHits : 1

  const byId = new Map<number, V8Node>()
  for (const node of data.nodes) byId.set(node.id, node)

  const childIds = new Set<number>()
  for (const node of data.nodes) for (const child of node.children ?? []) childIds.add(child)
  const rootNode = data.nodes.find((n) => !childIds.has(n.id)) ?? data.nodes[0]

  // Iterative build: a deep recursion in the profiled program becomes a deep
  // tree here, and a recursive builder blows the stack on real profiles.
  const built = new Map<number, ProfileFrame>()
  const order: number[] = []
  const stack = [rootNode.id]
  const seen = new Set<number>()

  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const node = byId.get(id)
    if (!node) continue

    built.set(id, {
      id,
      functionName: node.callFrame.functionName || '(anonymous)',
      url: node.callFrame.url ?? '',
      lineNumber: (node.callFrame.lineNumber ?? -1) + 1,
      selfTime: (node.hitCount ?? 0) * msPerHit,
      totalTime: 0,
      children: [],
    })
    order.push(id)
    for (const child of node.children ?? []) stack.push(child)
  }

  for (const id of order) {
    const node = byId.get(id)
    const frame = built.get(id)
    if (!node || !frame) continue
    for (const childId of node.children ?? []) {
      const child = built.get(childId)
      if (child) frame.children.push(child)
    }
  }

  // Totals bottom-up: `order` is a pre-order push sequence, so walking it
  // backwards guarantees children are summed before their parent.
  for (let i = order.length - 1; i >= 0; i--) {
    const frame = built.get(order[i])
    if (!frame) continue
    frame.totalTime = frame.selfTime + frame.children.reduce((sum, c) => sum + c.totalTime, 0)
  }

  const root = built.get(rootNode.id)!

  // Aggregate by function, not by call-tree node: the same function called from
  // twenty places is one line in the hot list, which is how you find it.
  //
  // Total time needs care with recursion. A recursive function appears at many
  // depths on the same stack, and naively summing every node's total counts the
  // inner frames once per level — a 79ms profile reporting 443ms in
  // `fibonacci`. Total is therefore only added for the *outermost* occurrence
  // on each stack; self time is per-node and never double counted.
  const aggregate = new Map<string, HotFunction>()
  const keyOf = (frame: ProfileFrame) => `${frame.functionName}@${frame.url}:${frame.lineNumber}`

  const walk: { frame: ProfileFrame; ancestors: Set<string> }[] = [
    { frame: root, ancestors: new Set() },
  ]
  while (walk.length) {
    const { frame, ancestors } = walk.pop()!
    const key = keyOf(frame)
    const entry = aggregate.get(key) ?? {
      functionName: frame.functionName,
      url: frame.url,
      lineNumber: frame.lineNumber,
      selfTime: 0,
      totalTime: 0,
      selfPercent: 0,
      totalPercent: 0,
    }
    entry.selfTime += frame.selfTime
    if (!ancestors.has(key)) entry.totalTime += frame.totalTime
    aggregate.set(key, entry)

    if (frame.children.length) {
      const nested = new Set(ancestors)
      nested.add(key)
      for (const child of frame.children) walk.push({ frame: child, ancestors: nested })
    }
  }

  const wall = root.totalTime || durationMs || 1
  const hot = Array.from(aggregate.values())
    .map((entry) => ({
      ...entry,
      selfPercent: (entry.selfTime / wall) * 100,
      totalPercent: (entry.totalTime / wall) * 100,
    }))
    .filter((entry) => entry.selfTime > 0)
    .sort((a, b) => b.selfTime - a.selfTime)
    .slice(0, 500)

  return {
    source,
    durationMs,
    sampleCount: data.samples?.length ?? totalHits,
    root,
    hot,
  }
}
