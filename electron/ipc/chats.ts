/**
 * Storage for AI conversations.
 *
 * One file per project, named by a hash of the project path so that two
 * projects with the same basename do not collide and a path with characters
 * that are illegal in a filename still works.
 *
 * Writes are whole-file. Conversations are small (tens of messages) and the
 * alternative — appending, with compaction — buys nothing at this size and
 * risks a torn file if the app exits mid-write.
 */
import { app, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ChatSummary, StoredChat } from '../../shared/chat'

/** Beyond this, the oldest chats are dropped when a new one is created. */
const MAX_CHATS_PER_PROJECT = 50

function chatsDir(): string {
  return path.join(app.getPath('userData'), 'chats')
}

function fileFor(root: string): string {
  const hash = createHash('sha256').update(root).digest('hex').slice(0, 16)
  return path.join(chatsDir(), `${hash}.json`)
}

async function readAll(root: string): Promise<StoredChat[]> {
  try {
    const raw = JSON.parse(await fs.readFile(fileFor(root), 'utf8'))
    return Array.isArray(raw?.chats) ? raw.chats : []
  } catch {
    return []
  }
}

async function writeAll(root: string, chats: StoredChat[]): Promise<void> {
  await fs.mkdir(chatsDir(), { recursive: true })
  await fs.writeFile(fileFor(root), JSON.stringify({ root, chats }, null, 2), 'utf8')
}

export function registerChatHandlers() {
  ipcMain.handle('chats:list', async (_e, root: string): Promise<ChatSummary[]> => {
    const chats = await readAll(root)
    return chats
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        messageCount: chat.messages.length,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })

  ipcMain.handle('chats:get', async (_e, root: string, id: string): Promise<StoredChat | null> => {
    return (await readAll(root)).find((chat) => chat.id === id) ?? null
  })

  ipcMain.handle('chats:save', async (_e, root: string, chat: StoredChat): Promise<ChatSummary[]> => {
    const chats = await readAll(root)
    const index = chats.findIndex((c) => c.id === chat.id)
    const record = { ...chat, updatedAt: Date.now() }
    if (index === -1) chats.push(record)
    else chats[index] = record

    // Keep the newest; an unbounded history file eventually costs a visible
    // pause on project open.
    chats.sort((a, b) => b.updatedAt - a.updatedAt)
    const kept = chats.slice(0, MAX_CHATS_PER_PROJECT)

    await writeAll(root, kept)
    return kept.map((c) => ({
      id: c.id,
      title: c.title,
      messageCount: c.messages.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
  })

  ipcMain.handle('chats:delete', async (_e, root: string, id: string): Promise<ChatSummary[]> => {
    const chats = (await readAll(root)).filter((chat) => chat.id !== id)
    await writeAll(root, chats)
    return chats.map((c) => ({
      id: c.id,
      title: c.title,
      messageCount: c.messages.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
  })
}
