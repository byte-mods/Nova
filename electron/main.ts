import { app, BrowserWindow, shell, ipcMain, nativeTheme } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerFsHandlers } from './ipc/fs'
import { registerGitHandlers } from './ipc/git'
import { registerAiHandlers } from './ipc/ai'
import { registerShellHandlers } from './ipc/shell'
import { registerAppHandlers } from './ipc/app'
import { registerIndexerHandlers } from './ipc/indexer'
import { registerLspHandlers } from './ipc/lsp'
import { registerTestHandlers } from './ipc/tests'
import { registerDebugHandlers } from './ipc/debug'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Opt-in remote debugging, for driving the app from tests/automation. Off
// unless the env var is set, so normal runs never expose a port.
if (process.env.NOVA_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', process.env.NOVA_DEBUG_PORT)
}

process.env.APP_ROOT = path.join(__dirname, '..')
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#111318',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Powers the built-in Chromium browser pane and the live UI preview.
      webviewTag: true,
      spellcheck: false,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // Anything the app itself tries to open in a new window goes to the OS browser;
  // in-app browsing happens inside the <webview> pane instead.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences) => {
    // Guest pages must never get Node access.
    delete (webPreferences as { preload?: string }).preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
  })

  // target=_blank inside the browser pane navigates in place rather than
  // spawning an OS window the user cannot see.
  mainWindow.webContents.on('did-attach-webview', (_event, guest) => {
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) guest.loadURL(url)
      return { action: 'deny' }
    })
  })

  if (VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function broadcast(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'

  const indexer = registerIndexerHandlers({ broadcast })
  const lsp = registerLspHandlers({ broadcast })
  const debugger_ = registerDebugHandlers({ broadcast })
  app.on('before-quit', () => {
    void lsp.dispose()
    void debugger_.dispose()
  })

  registerAppHandlers({ broadcast, getWindow: () => mainWindow })
  registerFsHandlers({ broadcast, onFileChanged: indexer.onFileChanged })
  registerGitHandlers()
  registerTestHandlers({ broadcast })
  registerAiHandlers({ broadcast })
  registerShellHandlers({ broadcast })

  ipcMain.handle('window:action', (_e, action: string) => {
    if (!mainWindow) return
    if (action === 'minimize') mainWindow.minimize()
    else if (action === 'maximize')
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    else if (action === 'close') mainWindow.close()
    else if (action === 'devtools') mainWindow.webContents.toggleDevTools()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
