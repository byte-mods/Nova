/**
 * A public URL for a local port, via a Cloudflare quick tunnel.
 *
 * `cloudflared tunnel --url http://127.0.0.1:PORT` opens an outbound
 * connection and hands back a `*.trycloudflare.com` address. Outbound matters:
 * it needs no account, no DNS, no port forwarding and no inbound firewall
 * rule, which is what makes it usable for "look at this for five minutes".
 *
 * The trade is that the URL is public the moment it exists. Nothing here is
 * responsible for that — the share server puts an unguessable token in the
 * path and serves nothing without it — but it is the reason this module
 * reports the URL loudly and stops cleanly rather than lingering.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { which, toolEnv } from './env'

/** The address a quick tunnel prints once it is up. */
const URL_PATTERN = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/i

/** Long enough for a slow handshake, short enough to not look hung. */
const READY_TIMEOUT_MS = 45_000

export interface TunnelHandle {
  url: string
  stop: () => Promise<void>
}

export class TunnelError extends Error {
  constructor(
    message: string,
    /** What the user should do about it, if anything. */
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'TunnelError'
  }
}

/** Whether `cloudflared` is on PATH, and where. */
export async function findCloudflared(): Promise<string> {
  return which('cloudflared')
}

export async function openTunnel(port: number, onLog?: (line: string) => void): Promise<TunnelHandle> {
  const binary = await findCloudflared()
  if (!binary) {
    throw new TunnelError('cloudflared is not installed.', 'brew install cloudflared')
  }

  const child = spawn(
    binary,
    [
      'tunnel',
      '--url',
      `http://127.0.0.1:${port}`,
      // Quick tunnels print their banner and progress to stderr; asking for
      // structured output makes the URL findable without scraping a box-drawn
      // banner.
      '--no-autoupdate',
      '--loglevel',
      'info',
    ],
    { env: toolEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
  )

  return new Promise<TunnelHandle>((resolve, reject) => {
    let settled = false
    let output = ''

    const stop = () => stopChild(child)

    const finish = (url: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ url, stop })
    }

    const fail = (error: TunnelError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void stop()
      reject(error)
    }

    const timer = setTimeout(() => {
      fail(
        new TunnelError(
          `The tunnel did not come up within ${READY_TIMEOUT_MS / 1000}s.`,
          output.slice(-400) || 'Check that outbound HTTPS is allowed.',
        ),
      )
    }, READY_TIMEOUT_MS)

    const read = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      output += text
      // Bounded: cloudflared is chatty and this runs for the life of a share.
      if (output.length > 20_000) output = output.slice(-8_000)
      for (const line of text.split('\n')) {
        if (line.trim()) onLog?.(line.trim())
      }
      // Matched against the accumulated output rather than this chunk: the URL
      // is printed inside a box-drawn banner, and a chunk boundary can land in
      // the middle of it. When that happened the tunnel was up and Nova waited
      // out its own timeout and reported failure.
      const match = URL_PATTERN.exec(output)
      if (match) finish(match[1])
    }

    child.stdout?.on('data', read)
    child.stderr?.on('data', read)

    child.on('error', (err) => {
      fail(new TunnelError(`Could not start cloudflared: ${err.message}`))
    })

    child.on('exit', (code) => {
      if (settled) return
      fail(
        new TunnelError(
          `cloudflared exited with code ${code ?? 'unknown'} before opening a tunnel.`,
          output.slice(-400),
        ),
      )
    })
  })
}

/**
 * Ends the process, escalating if it does not go.
 *
 * A tunnel left running is a URL left public, so this does not simply send a
 * signal and hope — it waits, and then insists.
 */
function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode) return Promise.resolve()

  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', done)

    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      resolve()
    }, 4000)

    try {
      child.kill('SIGTERM')
    } catch {
      done()
    }
  })
}
