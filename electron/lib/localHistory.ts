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

/** Records the content a file had *before* it was overwritten. */
export async function record(
  projectRoot: string,
  file: string,
  previousContent: string,
  label = 'save',
) {
  if (previousContent.length > MAX_SNAPSHOT_BYTES) return
  const bucket = bucketFor(projectRoot, file)
  await fs.mkdir(bucket, { recursive: true })

  const existing = await listRaw(bucket)
  const newest = existing[0]

  // Nothing changed since the last snapshot, or it was taken moments ago.
  if (newest) {
    if (Date.now() - newest.at < COALESCE_MS) return
    try {
      const previous = await fs.readFile(path.join(bucket, newest.id), 'utf8')
      if (previous === previousContent) return
    } catch {
      /* unreadable snapshot; fall through and write a new one */
    }
  }

  const id = `${Date.now()}-${label.replace(/[^a-z]/gi, '')}.snap`
  await fs.writeFile(path.join(bucket, id), previousContent, 'utf8')
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
