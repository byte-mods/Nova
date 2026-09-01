import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import os from 'node:os'
import path from 'node:path'
import type { RecentProject } from '../../shared/types'
import { buildProjectModel } from '../lib/projectModel'
import { readJsonFileOrQuarantine, withFileLock, writeJsonFile } from '../lib/fileStore'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
  getWindow: () => BrowserWindow | null
}

function storeFile(name: string) {
  return path.join(app.getPath('userData'), name)
}

/** How long a path may be before it is not a path but a payload. */
const MAX_PATH_LENGTH = 4096

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

  ipcMain.handle('app:recents', () =>
    readJsonFileOrQuarantine<RecentProject[]>(storeFile('recents.json'), []),
  )

  ipcMain.handle('app:addRecent', async (_e, projectPath: unknown): Promise<RecentProject[]> => {
    // Validated at the boundary rather than trusted: this arrives from the
    // renderer, and a non-string or a megabyte of text used to go straight into
    // the file that the launcher reads on every start.
    if (typeof projectPath !== 'string' || !projectPath || projectPath.length > MAX_PATH_LENGTH) {
      return readJsonFileOrQuarantine<RecentProject[]>(storeFile('recents.json'), [])
    }

    const file = storeFile('recents.json')
    return withFileLock(file, async () => {
      const current = await readJsonFileOrQuarantine<RecentProject[]>(file, [])
      const next: RecentProject[] = [
        { path: projectPath, name: path.basename(projectPath), openedAt: Date.now() },
        ...(Array.isArray(current) ? current : []).filter((r) => r?.path !== projectPath),
      ].slice(0, 12)
      await writeJsonFile(file, next)
      return next
    })
  })

  ipcMain.handle('app:homeDir', () => os.homedir())

  // Modules, SDKs and frameworks, detected from manifests already on disk.
  ipcMain.handle('app:projectModel', (_e, root: string) => buildProjectModel(root))

  ipcMain.handle('app:readSettings', () =>
    readJsonFileOrQuarantine<unknown>(storeFile('settings.json'), null),
  )

  ipcMain.handle('app:writeSettings', (_e, data: unknown) => {
    // Every setting the app has, in one non-atomic write of whatever the
    // renderer sent. A `null` from a malformed call used to be written
    // faithfully, which reset the app to defaults on the next start; a crash
    // mid-write left a truncated file that read as `null` and did the same.
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Settings must be an object.')
    }
    const file = storeFile('settings.json')
    return withFileLock(file, () => writeJsonFile(file, data))
  })

  ipcMain.handle('app:reveal', (_e, target: string) => {
    shell.showItemInFolder(target)
  })

  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
  })
}
