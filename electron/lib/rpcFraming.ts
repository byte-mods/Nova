/**
 * The `Content-Length` framing that LSP and DAP both speak.
 *
 * The two clients had the same fifteen lines, and the same two problems in them.
 *
 * The first is cost. Framing by `buffer = Buffer.concat([buffer, chunk])` copies
 * everything received so far for every chunk that arrives, so assembling one
 * large response is quadratic in its size — a 64 MB reply from a language server
 * on a big project spent seconds copying itself. Here the header is accumulated
 * (it is a few dozen bytes) and the body is collected as a list of chunks joined
 * exactly once, which makes the same reply linear.
 *
 * The second is that nothing bounded it. A server announcing `Content-Length:
 * 999999999999` had the old loop wait for a body that was never coming while
 * every byte it did send was retained — the process grew until it died, with no
 * message ever dispatched and nothing to explain why. A language server is a
 * program from the user's own toolchain rather than an attacker, but it can be
 * wedged, wrong, or replaced by a project's `.nova` config, and "grows until the
 * app dies" is not an acceptable response to any of those.
 */

/** Larger than any real reply, small enough that mistaking it for one is cheap. */
export const MAX_MESSAGE_BYTES = 64 * 1024 * 1024

/** A header this long is not a header. */
const MAX_HEADER_BYTES = 8 * 1024

const SEPARATOR = '\r\n\r\n'
const EMPTY = Buffer.alloc(0)

export class FramingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FramingError'
  }
}

export class ContentLengthFramer {
  private header: Buffer = EMPTY
  private bodyChunks: Buffer[] = []
  private bodyBytes = 0
  /** Bytes the current body still needs, or -1 while reading a header. */
  private need = -1

  constructor(private readonly max: number = MAX_MESSAGE_BYTES) {}

  /**
   * Feeds one chunk in and calls `onMessage` for each complete body it yields.
   *
   * Returns a `FramingError` rather than throwing it, because the caller's job
   * on a bad frame is to tear the connection down and report it — not to unwind
   * a stack out of a stream event.
   */
  push(chunk: Buffer, onMessage: (body: string) => void): FramingError | null {
    let input = chunk

    for (;;) {
      if (this.need >= 0) {
        const want = this.need - this.bodyBytes
        if (input.length < want) {
          // Held as a chunk rather than concatenated: this is the branch that
          // used to copy the whole message again for every packet of it.
          this.bodyChunks.push(input)
          this.bodyBytes += input.length
          return null
        }
        this.bodyChunks.push(input.subarray(0, want))
        const body = Buffer.concat(this.bodyChunks, this.need).toString('utf8')
        this.bodyChunks = []
        this.bodyBytes = 0
        this.need = -1
        input = input.subarray(want)
        onMessage(body)
        if (input.length === 0) return null
        continue
      }

      this.header = this.header.length === 0 ? input : Buffer.concat([this.header, input])
      input = EMPTY

      const end = this.header.indexOf(SEPARATOR)
      if (end === -1) {
        if (this.header.length > MAX_HEADER_BYTES) {
          return new FramingError('the message header never ended')
        }
        return null
      }

      const header = this.header.subarray(0, end).toString('ascii')
      const rest = this.header.subarray(end + SEPARATOR.length)
      this.header = EMPTY

      const match = /content-length:\s*(\d+)/i.exec(header)
      if (!match) {
        // Unparseable header; drop it rather than stalling forever.
        input = rest
        if (input.length === 0) return null
        continue
      }

      const length = Number(match[1])
      if (!Number.isSafeInteger(length) || length < 0) {
        return new FramingError(`unreadable Content-Length: ${match[1]}`)
      }
      if (length > this.max) {
        return new FramingError(
          `a message of ${length} bytes was announced, over the ${this.max}-byte limit`,
        )
      }

      this.need = length
      input = rest
      if (input.length === 0 && length > 0) return null
    }
  }

  /** Drops everything buffered, for a connection that is being torn down. */
  reset(): void {
    this.header = EMPTY
    this.bodyChunks = []
    this.bodyBytes = 0
    this.need = -1
  }
}
