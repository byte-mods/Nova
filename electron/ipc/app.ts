import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { RecentProject } from '../../shared/types'
import { buildProjectModel } from '../lib/projectModel'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
  getWindow: () => BrowserWindow | null
}

function storeFile(name: string) {
  return path.join(app.getPath('userData'), name)
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8')
}

export function registerAppHandlers(ctx: Ctx) {
  ipcMain.handle('app:openFolderDialog', async () => {
    const win = ctx.getWindow()
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'app:openFileDialog',
    async (_e, options?: { filters?: { name: string; extensions: string[] }[] }) => {
      const win = ctx.getWindow()
      const config = { properties: ['openFile' as const], filters: options?.filters }
      const result = win
        ? await dialog.showOpenDialog(win, config)
        : await dialog.showOpenDialog(config)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0]
    },
  )

  ipcMain.handle('app:recents', () => readJson<RecentProject[]>(storeFile('recents.json'), []))

  ipcMain.handle('app:addRecent', async (_e, projectPath: string) => {
    const file = storeFile('recents.json')
    const current = await readJson<RecentProject[]>(file, [])
    const next: RecentProject[] = [
      { path: projectPath, name: path.basename(projectPath), openedAt: Date.now() },
      ...current.filter((r) => r.path !== projectPath),
    ].slice(0, 12)
    await writeJson(file, next)
    return next
  })

  ipcMain.handle('app:homeDir', () => os.homedir())

  // Modules, SDKs and frameworks, detected from manifests already on disk.
  ipcMain.handle('app:projectModel', (_e, root: string) => buildProjectModel(root))

  ipcMain.handle('app:readSettings', () => readJson<unknown>(storeFile('settings.json'), null))

  ipcMain.handle('app:writeSettings', (_e, data: unknown) =>
    writeJson(storeFile('settings.json'), data),
  )

  ipcMain.handle('app:reveal', (_e, target: string) => {
    shell.showItemInFolder(target)
  })

  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })
}
