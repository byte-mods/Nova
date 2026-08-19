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

function secretsFile(): string {
  return path.join(app.getPath('userData'), 'ai-credentials.enc')
}

async function readAll(): Promise<Record<string, string>> {
  if (!safeStorage.isEncryptionAvailable()) return {}
  try {
    return JSON.parse(safeStorage.decryptString(await fs.readFile(secretsFile())))
  } catch {
    return {}
  }
}

/** The key for one provider, or an empty string. Main process only. */
export async function readAiKey(provider: AiProvider): Promise<string> {
  return (await readAll())[provider] ?? ''
}

/**
 * Stores or clears a key.
 *
 * Returns false when the platform has no encryption available, so the settings
 * page can say the key was not kept rather than implying it was.
 */
export async function writeAiKey(provider: AiProvider, key: string | null): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable()) return false

  const all = await readAll()
  if (key === null || !key.trim()) delete all[provider]
  else all[provider] = key.trim()

  const file = secretsFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, safeStorage.encryptString(JSON.stringify(all)))
  await fs.chmod(file, 0o600).catch(() => undefined)
  return true
}

/** Which providers have a key stored — never the keys themselves. */
export async function storedAiKeys(): Promise<AiProvider[]> {
  return Object.keys(await readAll()).filter((k) => k) as AiProvider[]
}
