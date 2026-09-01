/**
 * Reading and writing the small JSON files Nova keeps its own state in.
 *
 * Seven stores had grown the same three-line shape — read, `catch { return {} }`,
 * write the result back — and that shape loses data in two different ways.
 *
 * The first is the catch. "The file is not there yet" and "the file is there
 * and will not decrypt" are not the same event, but a bare catch answers `{}`
 * to both, and the write that follows persists that `{}` over a file that was
 * merely unreadable. One unreadable keychain entry took every stored API key
 * with it, and one bad byte in `chats.json` deleted the chat history — not when
 * it was written, but on the next save, which is what made it hard to see.
 *
 * The second is that a whole-file rewrite is not atomic. Two saves that
 * interleave lose one of them and report success for both, and a crash halfway
 * through `writeFile` leaves a truncated file that the next read cannot parse —
 * which walks straight into the first problem.
 *
 * So: a missing file is a missing file and anything else throws; every write
 * goes through a temporary file and a rename; and every read-modify-write for a
 * given path is serialised behind a lock, so the sequence is what it looks like.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Thrown when a file exists but cannot be turned back into state. */
export class StoreReadError extends Error {
  readonly file: string
  constructor(file: string, cause: unknown) {
    super(`${path.basename(file)} exists but could not be read: ${(cause as Error)?.message ?? cause}`)
    this.name = 'StoreReadError'
    this.file = file
  }
}

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Reads and parses a store file, or returns `fallback` when there is not one.
 *
 * A file that exists but does not parse throws `StoreReadError`, so the caller
 * has to decide what that means. Nothing here decides it for them by inventing
 * an empty value that a later write would make permanent.
 */
export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (err) {
    if (isMissing(err)) return fallback
    throw new StoreReadError(file, err)
  }
  // An empty file is what a torn write leaves behind, and treating it as the
  // fallback is how the old code lost data. It is damage, not absence.
  if (!text.trim()) throw new StoreReadError(file, new Error('the file is empty'))
  try {
    return JSON.parse(text) as T
  } catch (err) {
    throw new StoreReadError(file, err)
  }
}

/**
 * Reads a store file, and moves a damaged one aside rather than failing.
 *
 * For state where refusing to start is worse than starting empty — the recent
 * files list, say. The damaged copy is kept as `<name>.corrupt` so the user
 * still has it, which the old bare catch could not offer because it never knew
 * anything had gone wrong.
 */
export async function readJsonFileOrQuarantine<T>(file: string, fallback: T): Promise<T> {
  try {
    return await readJsonFile(file, fallback)
  } catch (err) {
    if (!(err instanceof StoreReadError)) throw err
    await fs.rename(file, `${file}.corrupt`).catch(() => undefined)
    return fallback
  }
}

/**
 * Writes a file so that it is either the old contents or the new ones.
 *
 * The temporary file is in the same directory, because `rename` is only atomic
 * within a filesystem and `/tmp` is often a different one. The directory handle
 * is synced after the rename so the entry itself survives a power loss, not
 * just the bytes it points at.
 */
export async function writeFileAtomic(
  file: string,
  data: string | Uint8Array,
  options: { mode?: number } = {},
): Promise<void> {
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const temp = path.join(dir, `.${path.basename(file)}.${randomBytes(6).toString('hex')}.tmp`)

  try {
    const handle = await fs.open(temp, 'w', options.mode ?? 0o600)
    try {
      await handle.writeFile(data)
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (options.mode !== undefined) await fs.chmod(temp, options.mode).catch(() => undefined)
    await fs.rename(temp, file)
  } catch (err) {
    await fs.rm(temp, { force: true }).catch(() => undefined)
    throw err
  }

  const dirHandle = await fs.open(dir, 'r').catch(() => null)
  if (dirHandle) {
    // Not every platform supports syncing a directory handle, and where it is
    // unsupported the rename is durable enough on its own.
    await dirHandle.sync().catch(() => undefined)
    await dirHandle.close().catch(() => undefined)
  }
}

/** Writes JSON atomically, formatted the way the rest of these files are. */
export function writeJsonFile(file: string, value: unknown, options?: { mode?: number }): Promise<void> {
  return writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, options)
}

/**
 * One promise chain per path, so read-modify-write on a store is serialised.
 *
 * Keyed by the resolved path rather than by the store, because two modules
 * writing the same file is exactly the case that needs serialising. A waiter
 * count drops the entry once the last one drains, so this does not grow with
 * the number of files the session touches.
 */
const chains = new Map<string, { tail: Promise<unknown>; waiting: number }>()

export function withFileLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const key = path.resolve(file)
  const entry = chains.get(key) ?? { tail: Promise.resolve(), waiting: 0 }
  entry.waiting++
  chains.set(key, entry)

  // `work` runs whether the previous holder resolved or rejected: one store's
  // failed write must not wedge every write that queued behind it.
  const result = entry.tail.then(work, work)

  entry.tail = result.then(
    () => undefined,
    () => undefined,
  )
  void entry.tail.then(() => {
    entry.waiting--
    if (entry.waiting === 0 && chains.get(key) === entry) chains.delete(key)
  })

  return result
}
