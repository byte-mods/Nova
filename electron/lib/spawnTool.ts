/**
 * Running a command-line tool that Windows installed as a script shim.
 *
 * Since the fix for CVE-2024-27980, Node refuses to execute a `.cmd` or `.bat`
 * directly: `spawn` throws `EINVAL`, and it throws *synchronously*, before there
 * is a child process to attach an `error` listener to. Every AI CLI npm installs
 * is exactly such a shim — `claude.cmd`, `codex.cmd`, `gemini.cmd` — so on
 * Windows every assistant failed the moment it was asked to start, and the
 * console, which waits for a run to end, waited for one that had never begun.
 *
 * There are two ways to run a shim, and the difference matters because one of
 * the arguments is the user's prompt.
 *
 * The first is to read the shim and run what it points at. An npm shim is a
 * fixed shape — it forwards `%*` to one program — so the real executable can be
 * lifted out of it and spawned with an ordinary argv array. Nothing re-parses
 * anything, which means a prompt containing quotes, ampersands or newlines
 * arrives exactly as it was typed. This is the path taken whenever the shim can
 * be read.
 *
 * The second is `cmd.exe`, used only when the shim cannot be resolved. It is
 * strictly worse: `cmd` parses the line, and then the shim's own `%*` makes
 * `cmd` parse it a second time, so every metacharacter has to survive two
 * passes — hence the doubled `^` escaping below, following the rules at
 * https://qntm.org/cmd. A newline cannot survive a batch file at all, `cmd`
 * being line-based, so on this path a multi-line argument is truncated. That is
 * a limitation of `cmd` rather than a choice, and it is why the first path
 * exists and is preferred.
 *
 * What is never used is `shell: true`: Node joins the arguments into one string
 * without quoting any of them, so an `&` anywhere in a prompt would end the
 * command and start another one.
 */
import { EventEmitter } from 'node:events'
import { accessSync, constants, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import path from 'node:path'
import { execFile, spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'

/** A `.cmd`/`.bat` on Windows is a script, not an image the kernel can run. */
export function isWindowsShim(file: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
}

/**
 * What an npm shim forwards to: the program, plus any arguments the shim itself
 * supplies ahead of `%*` — a shim that runs a JavaScript entry point names the
 * interpreter first and the script second, and dropping that second half would
 * run the interpreter with nothing to interpret.
 *
 * `null` means the line could not be read confidently, which is not a failure:
 * it is the signal to fall back to `cmd.exe` and let the shim run itself.
 */
export function resolveShimTarget(shim: string): { file: string; prefix: string[] } | null {
  let text: string
  try {
    text = readFileSync(shim, 'utf8')
  } catch {
    return null
  }
  const dir = path.dirname(shim)
  for (const line of text.split(/\r?\n/)) {
    // The line that runs the tool is the one that forwards the arguments on.
    if (!line.includes('%*')) continue
    const head = line.slice(0, line.indexOf('%*'))
    // Quoted runs stay whole; anything else splits on whitespace.
    const tokens = (head.match(/"[^"]*"|\S+/g) ?? [])
      .map((t) => (t.startsWith('"') ? t.slice(1, -1) : t))
      .map((t) => t.replace(/%~?dp0%?/gi, `${dir}${path.sep}`))
      .filter(Boolean)
    if (!tokens.length) continue
    // A variable this code did not expand means the line is not understood, and
    // guessing at it would run the wrong program.
    if (tokens.some((t) => t.includes('%'))) continue
    const [program, ...prefix] = tokens
    if (!/\.exe$/i.test(program)) continue
    // Resolve relative to the shim, so an install that was moved still works.
    const file = path.resolve(dir, program)
    try {
      accessSync(file, constants.X_OK)
    } catch {
      continue
    }
    // Prefix tokens are passed on as written — `%dp0%` has already made a script
    // path absolute, and a flag is not a path to be resolved against anything.
    return { file, prefix }
  }
  return null
}

/**
 * Quote one argument so it survives `cmd.exe`. `doubleEscape` covers the second
 * parse that a `.cmd`'s `%*` forces on everything it forwards.
 */
export function escapeArgument(arg: string, doubleEscape = false): string {
  // Backslashes are only special to the C runtime when they precede a quote,
  // and there they must be doubled; the quote itself takes a backslash.
  let out = String(arg).replace(/(\\*)"/g, '$1$1\\"')
  // A trailing backslash would otherwise escape the closing quote added below.
  out = out.replace(/(\\*)$/, '$1$1')
  out = `"${out}"`
  // cmd.exe reads the line before the C runtime does and acts on these itself,
  // the quotes just added included: `^"` reaches the next parser as a quote.
  const meta = /[()%!^<>&|"]/g
  out = out.replace(meta, '^$&')
  return doubleEscape ? out.replace(meta, '^$&') : out
}

/** The command line handed to `cmd.exe /c`, quoted for both of its passes. */
export function windowsCommandLine(file: string, args: readonly string[]): string {
  return [escapeArgument(file), ...args.map((a) => escapeArgument(a, true))].join(' ')
}

/** `/d` skips registry AutoRun, `/s` fixes quote handling, `/c` runs and exits. */
function viaInterpreter(file: string, args: readonly string[]) {
  return {
    file: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', windowsCommandLine(file, args)],
    verbatim: true,
  }
}

/**
 * How a given file actually has to be launched on this platform. Exported for
 * the one caller that needs to keep its own `execFile` — it writes to the
 * child's stdin, which the wrappers below do not expose.
 */
export function toolInvocation(file: string, args: readonly string[]) {
  if (!isWindowsShim(file)) return { file, args, verbatim: false }
  const target = resolveShimTarget(file)
  if (target) return { file: target.file, args: [...target.prefix, ...args], verbatim: false }
  return viaInterpreter(file, args)
}

/**
 * `child_process.spawn`, except that a Windows shim runs instead of throwing,
 * and a failure to start always arrives as an `error` event rather than as a
 * synchronous throw. Callers then have exactly one failure path to handle,
 * which is the difference between a run that ends badly and one that never ends.
 */
export function spawnTool(
  file: string,
  args: readonly string[],
  options: SpawnOptions = {},
): ChildProcess {
  const call = toolInvocation(file, args)
  const opts = call.verbatim ? { ...options, windowsVerbatimArguments: true } : options
  try {
    return spawn(call.file, [...call.args], opts)
  } catch (err) {
    return failedChild(err)
  }
}

/**
 * A child that never started, shaped enough like one that a caller can wire it
 * up without checking. Two details matter and both were ways to turn a failed
 * start into something worse:
 *
 * `stdout` and `stderr` are real, already-ended streams, because a caller that
 * reaches straight for `child.stdout.setEncoding` would otherwise throw on the
 * very failure this is meant to report.
 *
 * The `error` event waits for someone to listen. Callers routinely `await`
 * something between spawning and attaching their handler, and an `error` with
 * no listener does not go unnoticed — Node throws it, which would take the main
 * process down instead of failing one run.
 */
function failedChild(err: unknown): ChildProcess {
  const ended = () => new Readable({ read() { this.push(null) } })
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, { stdout: ended(), stderr: ended(), stdin: null, pid: undefined })
  child.kill = () => true

  let delivered = false
  const deliver = () => {
    if (delivered) return
    delivered = true
    // `error` alone: the caller's error handler is what ends the run, and a
    // `close` after it would report the same run ending twice.
    child.emit('error', err)
  }
  for (const method of ['on', 'once', 'addListener'] as const) {
    const original = child[method].bind(child)
    child[method] = ((event: string, listener: (...a: unknown[]) => void) => {
      const result = original(event, listener)
      if (event === 'error') setImmediate(deliver)
      return result
    }) as typeof child[typeof method]
  }
  return child
}

type ExecResult = { stdout: string; stderr: string }
type ExecOptions = { env?: NodeJS.ProcessEnv; timeout?: number; cwd?: string; maxBuffer?: number }

/**
 * The `promisify(execFile)` shape the rest of the app uses, with the same shim
 * handling. Rejects the way `promisify(execFile)` does, so a caller that already
 * catches keeps working unchanged.
 */
export function execTool(
  file: string,
  args: readonly string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const call = toolInvocation(file, args)
  const opts = call.verbatim ? { ...options, windowsVerbatimArguments: true } : options
  return new Promise((resolve, reject) => {
    try {
      execFile(call.file, [...call.args], opts, (err, stdout, stderr) => {
        if (err) reject(err)
        else resolve({ stdout: String(stdout), stderr: String(stderr) })
      })
    } catch (err) {
      reject(err)
    }
  })
}
