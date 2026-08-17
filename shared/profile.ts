/**
 * CPU profiles, flattened into something a flame graph can draw.
 *
 * V8's `.cpuprofile` is the interchange format here: Node writes it with
 * `--cpu-prof`, Chrome DevTools exports it, and `pprof`-style tools can convert
 * to it. Supporting that one format covers most of what a developer will
 * actually have in hand, without Nova having to attach a sampler itself.
 */

export interface ProfileFrame {
  id: number
  functionName: string
  url: string
  lineNumber: number
  /** Samples attributed to this frame alone. */
  selfTime: number
  /** Samples in this frame and everything it called. */
  totalTime: number
  children: ProfileFrame[]
}

/** One row of the "where did the time go" table. */
export interface HotFunction {
  functionName: string
  url: string
  lineNumber: number
  selfTime: number
  totalTime: number
  selfPercent: number
  totalPercent: number
}

export interface CpuProfile {
  /** Absolute path of the .cpuprofile this came from. */
  source: string
  /** Milliseconds covered by the profile. */
  durationMs: number
  sampleCount: number
  /** Call tree, rooted at the profile's root node. */
  root: ProfileFrame
  /** Flattened, sorted by self time descending. */
  hot: HotFunction[]
}
