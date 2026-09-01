import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { HistoryRevision } from '../../shared/types'

/**
 * A per-file revision store, independent of Git — the point is to recover work
 * that was never committed (or never even saved deliberately), including edits
 * the AI console made.
 */

const MAX_REVISIONS_PER_FILE = 60
const MAX_AGE_DAYS = 30
const MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024

/**
 * The ceiling when the caller says this snapshot is the only copy left.
 *
 * The ordinary cap exists so history does not fill the disk with copies of
 * generated files. But it was also refusing exactly the case history is for —
 * a large file about to be overwritten by something smaller — so a second,
 * higher ceiling covers that without giving up the first one entirely.
 */
const MAX_CRITICAL_SNAPSHOT_BYTES = 64 * 1024 * 1024
/** Snapshots closer together than this collapse into the previous one. */
const COALESCE_MS = 60_000

function hash(value: string) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16)
}

function historyRoot() {
  return path.join(app.getPath('userData'), 'local-history')
}

function bucketFor(projectRoot: string, file: string) {
  return path.join(historyRoot(), hash(projectRoot), hash(file))
}

/**
 * Records the content a file had *before* it was overwritten.
 *
 * `critical` marks a save that is the last chance to keep this content — the
 * caller knows the write about to happen cannot be reconstructed. It raises the
 * size cap, because refusing to snapshot a large file and then letting it be
 * overwritten is the one outcome this module exists to prevent.
 */
export async function record(
  projectRoot: string,
  file: string,
  previousContent: string,
  label = 'save',
  options: { critical?: boolean } = {},
) {
  const cap = options.critical ? MAX_CRITICAL_SNAPSHOT_BYTES : MAX_SNAPSHOT_BYTES
  if (previousContent.length > cap) return
  const bucket = bucketFor(projectRoot, file)
  await fs.mkdir(bucket, { recursive: true })

  const existing = await listRaw(bucket)
  const newest = existing[0]

  // Within the coalescing window the new snapshot *replaces* the previous one
  // rather than being dropped. Dropping it is what the old code did, and it
  // meant a burst of saves — which is what a save-on-type editor produces —
  // kept only the oldest content and lost every state after it. Replacing
  // keeps one entry per window, which is what "collapse" was supposed to mean.
  let replacing: string | undefined
  if (newest) {
    try {
      const previous = await fs.readFile(path.join(bucket, newest.id), 'utf8')
      // Genuinely nothing changed; there is no new state to keep.
      if (previous === previousContent) return
    } catch {
      /* unreadable snapshot; fall through and write a new one */
    }
    if (Date.now() - newest.at < COALESCE_MS) replacing = newest.id
  }

  const id = `${Date.now()}-${label.replace(/[^a-z]/gi, '')}.snap`
  await fs.writeFile(path.join(bucket, id), previousContent, 'utf8')
  if (replacing && replacing !== id) {
    await fs.rm(path.join(bucket, replacing), { force: true }).catch(() => undefined)
  }
  await fs.writeFile(path.join(bucket, 'source.txt'), file, 'utf8').catch(() => undefined)

  // Prune by count and age.
  const all = await listRaw(bucket)
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000
  const doomed = all.filter((rev, index) => index >= MAX_REVISIONS_PER_FILE || rev.at < cutoff)
  await Promise.all(doomed.map((rev) => fs.rm(path.join(bucket, rev.id), { force: true })))
}

async function listRaw(bucket: string): Promise<HistoryRevision[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(bucket)
  } catch {
    return []
  }
  return entries
    .filter((name) => name.endsWith('.snap'))
    .map((id) => {
      const [stamp, label] = id.replace('.snap', '').split('-')
      return { id, at: Number(stamp) || 0, label: label || 'save', size: 0 }
    })
    .sort((a, b) => b.at - a.at)
}

export async function list(projectRoot: string, file: string): Promise<HistoryRevision[]> {
  const bucket = bucketFor(projectRoot, file)
  const revisions = await listRaw(bucket)
  return Promise.all(
    revisions.map(async (revision) => {
      try {
        const stat = await fs.stat(path.join(bucket, revision.id))
        return { ...revision, size: stat.size }
      } catch {
        return revision
      }
    }),
  )
}

export async function read(projectRoot: string, file: string, id: string): Promise<string> {
  try {
    return await fs.readFile(path.join(bucketFor(projectRoot, file), id), 'utf8')
  } catch {
    return ''
  }
}

export async function clear(projectRoot: string, file: string) {
  await fs.rm(bucketFor(projectRoot, file), { recursive: true, force: true })
}
