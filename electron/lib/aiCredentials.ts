/**
 * API keys for the vendor endpoints Nova can point the Claude CLI at.
 *
 * Stored through Electron's `safeStorage`, which is backed by the OS keychain,
 * for the same reason the database passwords are: a key in a settings file is a
 * key in every backup, every sync folder and every screen-share of that
 * directory. When the platform cannot encrypt, nothing is written at all —
 * making the user paste the key again is a smaller harm than leaving it in
 * plaintext on disk without telling them.
 *
 * Only ever read in the main process. The renderer can save a key and ask
 * whether one exists; it cannot read one back, so a compromised renderer or a
 * plugin cannot exfiltrate what the user pasted.
 */
import { app, safeStorage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AiProvider } from '../../shared/types'
import { StoreReadError, withFileLock, writeFileAtomic } from './fileStore'

function secretsFile(): string {
  return path.join(app.getPath('userData'), 'ai-credentials.enc')
}

/**
 * Every key, or a thrown error.
 *
 * The distinction this makes is the whole point: no file yet means there are no
 * keys, and `{}` is the truth. A file that will not decrypt — a keychain the OS
 * has locked, a profile copied to another machine — means the keys are there
 * and unreadable *right now*, which is not the same thing at all. Answering
 * `{}` to both is what let one unreadable read, followed by one save, erase
 * every other provider's key.
 */
async function readAll(): Promise<Record<string, string>> {
  if (!safeStorage.isEncryptionAvailable()) return {}

  let encrypted: Buffer
  try {
    encrypted = await fs.readFile(secretsFile())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new StoreReadError(secretsFile(), err)
  }

  try {
    return JSON.parse(safeStorage.decryptString(encrypted))
  } catch (err) {
    throw new StoreReadError(secretsFile(), err)
  }
}

/**
 * The key for one provider, or an empty string.
 *
 * Reading for *use* tolerates an unreadable store — a request that goes out
 * without a key fails with the vendor's own 401, which is a better outcome than
 * refusing to send it. Writing does not tolerate it; see `writeAiKey`.
 */
export async function readAiKey(provider: AiProvider): Promise<string> {
  try {
    return (await readAll())[provider] ?? ''
  } catch {
    return ''
  }
}

/**
 * Stores or clears a key.
 *
 * Returns false when the platform has no encryption available, so the settings
 * page can say the key was not kept rather than implying it was.
 */
export async function writeAiKey(provider: AiProvider, key: string | null): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable()) return false

  const file = secretsFile()
  // Serialised, because saving two providers' keys at once used to mean each
  // read the same state and the second write dropped the first one's key.
  return withFileLock(file, async () => {
    // Deliberately not caught: a store that exists but will not decrypt must
    // stop the write, or the write is what destroys it.
    const all = await readAll()
    if (key === null || !key.trim()) delete all[provider]
    else all[provider] = key.trim()

    await writeFileAtomic(file, safeStorage.encryptString(JSON.stringify(all)), { mode: 0o600 })
    return true
  })
}

/**
 * Which providers have a key stored — never the keys themselves.
 *
 * An unreadable store answers "none", which is what the settings page can
 * usefully draw. `writeAiKey` is the one that must not paper over it.
 */
export async function storedAiKeys(): Promise<AiProvider[]> {
  try {
    return Object.keys(await readAll()).filter((k) => k) as AiProvider[]
  } catch {
    return []
  }
}
