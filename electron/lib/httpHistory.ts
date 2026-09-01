/**
 * What happened, and what came back.
 *
 * Two stores, deliberately separate. The index is a small list of every request
 * that has been run and is loaded whole; the bodies live one file per entry and
 * are read only when an entry is opened. A single combined file would have to
 * be rewritten in full on every request, and would grow without bound in
 * memory — an API returning megabyte responses makes that immediate.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import type { HistoryEntry, HttpResponse } from '../../shared/http'
import { writeFileAtomic } from './fileStore'

/** Entries past this are dropped, oldest first, along with their bodies. */
const MAX_ENTRIES = 200

export class HttpHistory {
  private entries: HistoryEntry[] = []
  private dir = ''
  private saving: Promise<void> | null = null
  private counter = 0

  async open(storageDir: string) {
    this.dir = path.join(storageDir, 'history')
    try {
      const raw = await fs.readFile(path.join(this.dir, 'index.json'), 'utf8')
      const parsed = JSON.parse(raw) as HistoryEntry[]
      this.entries = Array.isArray(parsed) ? parsed : []
    } catch {
      this.entries = []
    }
  }

  list(file?: string): HistoryEntry[] {
    const all = file ? this.entries.filter((e) => e.file === file) : this.entries
    // Newest first: the last thing run is what you want to look at.
    return [...all].reverse()
  }

  async record(
    file: string,
    name: string,
    url: string,
    response: HttpResponse,
  ): Promise<HistoryEntry> {
    const entry: HistoryEntry = {
      // The counter disambiguates two requests finishing in the same
      // millisecond, which a fast local API does constantly.
      id: `h-${response.at}-${this.counter++}`,
      file,
      requestId: response.requestId,
      name,
      method: response.sent?.method ?? '',
      url: response.sent?.url ?? url,
      protocol: response.protocol,
      status: response.status,
      durationMs: response.durationMs,
      size: response.size,
      at: response.at,
      error: response.error,
    }

    this.entries.push(entry)
    const dropped = this.entries.length > MAX_ENTRIES ? this.entries.splice(0, this.entries.length - MAX_ENTRIES) : []

    await this.write(entry, response, dropped)
    return entry
  }

  /** The full response for an entry, or null once it has been trimmed away. */
  async body(id: string): Promise<HttpResponse | null> {
    if (!this.dir) return null
    try {
      return JSON.parse(await fs.readFile(this.bodyPath(id), 'utf8')) as HttpResponse
    } catch {
      return null
    }
  }

  async clear() {
    this.entries = []
    if (!this.dir) return
    await fs.rm(this.dir, { recursive: true, force: true }).catch(() => undefined)
  }

  private bodyPath(id: string) {
    // Ids are generated here, but a traversal in one would write outside the
    // history directory — so the name is stripped to what ids can contain.
    return path.join(this.dir, `${id.replace(/[^A-Za-z0-9_-]/g, '')}.json`)
  }

  /** Serialised, so two requests finishing together cannot interleave writes. */
  private write(entry: HistoryEntry, response: HttpResponse, dropped: HistoryEntry[]): Promise<void> {
    if (!this.dir) return Promise.resolve()
    const task = (this.saving ?? Promise.resolve())
      .then(async () => {
        await fs.mkdir(this.dir, { recursive: true })
        // The bodies first, then the index. The index is what names them, so
        // writing it last means a crash between the two leaves an orphaned body
        // rather than an index pointing at one that is not there.
        //
        // Both go through a temporary file and a rename: a torn `index.json`
        // used to read back as no history at all, and since every later write
        // rebuilds the file from that reading, the whole list went with it —
        // while the bodies stayed on disk forever, referenced by nothing.
        await writeFileAtomic(this.bodyPath(entry.id), JSON.stringify(response))
        await writeFileAtomic(
          path.join(this.dir, 'index.json'),
          `${JSON.stringify(this.entries, null, 2)}\n`,
        )
        for (const old of dropped) {
          await fs.rm(this.bodyPath(old.id), { force: true }).catch(() => undefined)
        }
      })
      .catch(() => undefined)
    this.saving = task
    return task
  }
}
