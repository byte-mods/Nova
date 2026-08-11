import { ipcMain } from 'electron'
import type { IndexStatus } from '../../shared/types'
import { ProjectIndex } from '../lib/projectIndex'

interface Ctx {
  broadcast: (channel: string, payload: unknown) => void
}

const index = new ProjectIndex()
let refreshTimer: ReturnType<typeof setTimeout> | undefined
const pendingRefresh = new Set<string>()

export function registerIndexerHandlers(ctx: Ctx) {
  const publish = (status: IndexStatus) => ctx.broadcast('index:status', status)

  ipcMain.handle('index:build', async (_e, root: string) => {
    await index.build(root, publish)
    return index.status()
  })

  ipcMain.handle('index:status', () => index.status())

  ipcMain.handle('index:definitions', (_e, name: string, fromFile?: string) =>
    index.definitions(name, fromFile),
  )

  ipcMain.handle('index:references', (_e, name: string, fromFile?: string) =>
    index.references(name, fromFile),
  )

  ipcMain.handle('index:documentSymbols', (_e, file: string) => index.documentSymbols(file))

  ipcMain.handle('index:completions', (_e, prefix: string, fromFile?: string, limit?: number) =>
    index.completions(prefix, fromFile, limit),
  )

  ipcMain.handle('index:workspaceSymbols', (_e, query: string, limit?: number) =>
    index.workspaceSymbols(query, limit),
  )

  return {
    /** Called by the file watcher; batched so a burst of writes costs one pass. */
    onFileChanged(file: string) {
      pendingRefresh.add(file)
      clearTimeout(refreshTimer)
      refreshTimer = setTimeout(async () => {
        const batch = [...pendingRefresh]
        pendingRefresh.clear()
        for (const target of batch) await index.refresh(target)
        if (index.ready) publish(index.status())
      }, 400)
    },
  }
}
