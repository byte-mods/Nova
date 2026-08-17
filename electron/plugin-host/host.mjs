/**
 * The plugin host.
 *
 * Third-party plugin code runs here — a forked Node process, never in the main
 * process and never in the renderer. That costs one process and a message hop,
 * and buys the two properties that matter: a plugin that throws, leaks or spins
 * cannot take the editor down with it, and a plugin has no ambient handle on
 * `BrowserWindow`, `ipcMain` or the DOM. Everything it can reach, it must ask
 * the parent for by name.
 *
 * The API object handed to a plugin is a facade: each method turns into an
 * `rpc` message the parent fulfils. Permission checks live in the parent, which
 * is the only side a plugin cannot rewrite. The checks repeated here exist so an
 * author gets a clear error at the call site rather than a silent rejection.
 *
 * This file is plain ESM with no imports on purpose: it is copied to the build
 * output verbatim and must run under `ELECTRON_RUN_AS_NODE` with nothing else
 * on disk beside it.
 */

/** @type {Map<string, {dir: string, permissions: Set<string>, commands: Map<string, Function>, disposers: Function[]}>} */
const plugins = new Map()

/** Outstanding parent calls, keyed by request id. */
const pending = new Map()
let nextRequestId = 1
/** Makes each module import URL unique; see the note in `loadPlugin`. */
let loadCounter = 1

function send(message) {
  if (process.send) process.send(message)
}

function log(pluginId, level, text) {
  send({ t: 'log', pluginId, level, text: String(text) })
}

/** Issues an rpc to the parent and resolves when it answers. */
function callParent(pluginId, method, params) {
  const id = `r${nextRequestId++}`
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    send({ t: 'rpc', id, pluginId, method, params })
  })
}

/** Throws a helpful error before a call the plugin was never granted. */
function requirePermission(record, permission, method) {
  if (!record.permissions.has(permission)) {
    throw new Error(
      `${method} requires the "${permission}" permission. Add it to \`permissions\` in nova-plugin.json, then reinstall the plugin.`,
    )
  }
}

/**
 * Builds the `nova` object a plugin's `activate()` receives.
 *
 * Grouped by capability rather than by permission so the shape reads like an
 * editor API, with the permission named in the error when one is missing.
 */
function makeApi(pluginId, record) {
  const rpc = (method, params) => callParent(pluginId, method, params)

  return {
    /** The plugin's own identity and paths. */
    plugin: {
      id: pluginId,
      dir: record.dir,
    },

    commands: {
      /**
       * Registers a handler for a command declared in `contributes.commands`.
       * Registering an id the manifest does not declare is allowed but the
       * command will not appear in the palette.
       */
      register(commandId, handler) {
        if (typeof handler !== 'function') throw new TypeError('commands.register needs a function.')
        record.commands.set(commandId, handler)
        return { dispose: () => record.commands.delete(commandId) }
      },
      /** Runs a Nova command, e.g. "explain" or another plugin's command. */
      execute(commandId, args) {
        return rpc('commands.execute', { commandId, args })
      },
    },

    workspace: {
      /** Absolute path of the open project, or null when none is open. */
      root() {
        return rpc('workspace.root', {})
      },
      readFile(file) {
        requirePermission(record, 'workspace:read', 'workspace.readFile')
        return rpc('workspace.readFile', { file })
      },
      writeFile(file, content) {
        requirePermission(record, 'workspace:write', 'workspace.writeFile')
        return rpc('workspace.writeFile', { file, content })
      },
      list(dir) {
        requirePermission(record, 'workspace:read', 'workspace.list')
        return rpc('workspace.list', { dir })
      },
      findFiles(query, limit) {
        requirePermission(record, 'workspace:read', 'workspace.findFiles')
        return rpc('workspace.findFiles', { query, limit })
      },
      search(query, options) {
        requirePermission(record, 'workspace:read', 'workspace.search')
        return rpc('workspace.search', { query, options })
      },
    },

    editor: {
      /** Path of the file in the active tab, or null. */
      activeFile() {
        requirePermission(record, 'editor', 'editor.activeFile')
        return rpc('editor.activeFile', {})
      },
      selection() {
        requirePermission(record, 'editor', 'editor.selection')
        return rpc('editor.selection', {})
      },
      /** Replaces a range in an open buffer. Line/column are 1-based. */
      applyEdit(file, edit) {
        requirePermission(record, 'editor', 'editor.applyEdit')
        return rpc('editor.applyEdit', { file, edit })
      },
      open(file, line) {
        requirePermission(record, 'editor', 'editor.open')
        return rpc('editor.open', { file, line })
      },
    },

    ui: {
      /** A toast. `kind` is "info" | "warn" | "error". */
      showMessage(text, kind = 'info') {
        requirePermission(record, 'ui', 'ui.showMessage')
        return rpc('ui.showMessage', { text, kind })
      },
      /** Renders HTML into a view declared in `contributes.views`. */
      setViewHtml(viewId, html) {
        requirePermission(record, 'ui', 'ui.setViewHtml')
        return rpc('ui.setViewHtml', { viewId, html })
      },
      setStatusBarItem(id, item) {
        requirePermission(record, 'ui', 'ui.setStatusBarItem')
        return rpc('ui.setStatusBarItem', { id, item })
      },
      /** Asks the user a question. Resolves to the chosen label, or null. */
      prompt(question, choices) {
        requirePermission(record, 'ui', 'ui.prompt')
        return rpc('ui.prompt', { question, choices })
      },
    },

    git: {
      status() {
        requirePermission(record, 'git', 'git.status')
        return rpc('git.status', {})
      },
      log(limit) {
        requirePermission(record, 'git', 'git.log')
        return rpc('git.log', { limit })
      },
    },

    shell: {
      /** Runs a command in the workspace and resolves with its output. */
      exec(command, options) {
        requirePermission(record, 'shell', 'shell.exec')
        return rpc('shell.exec', { command, options })
      },
    },

    /** Per-plugin key/value storage, persisted across restarts. */
    storage: {
      get(key) {
        return rpc('storage.get', { key })
      },
      set(key, value) {
        return rpc('storage.set', { key, value })
      },
    },

    secrets: {
      get(key) {
        requirePermission(record, 'secrets', 'secrets.get')
        return rpc('secrets.get', { key })
      },
      set(key, value) {
        requirePermission(record, 'secrets', 'secrets.set')
        return rpc('secrets.set', { key, value })
      },
    },

    log: {
      info: (text) => log(pluginId, 'info', text),
      warn: (text) => log(pluginId, 'warn', text),
      error: (text) => log(pluginId, 'error', text),
    },
  }
}

async function loadPlugin(spec) {
  const { id, dir, main, permissions } = spec
  const record = {
    dir,
    permissions: new Set(permissions || []),
    commands: new Map(),
    disposers: [],
  }
  plugins.set(id, record)

  if (!main) {
    // Manifest-only plugin: nothing to run, but it still "loaded" successfully.
    send({ t: 'loaded', pluginId: id, commands: [] })
    return
  }

  // Node caches ES modules by URL for the life of the process, so re-importing
  // the same path after an update would silently return the *old* code. A
  // unique query per load defeats the cache, which is what makes "Update" and
  // disable/enable actually reload a plugin rather than appear to.
  const url = `file://${main}?load=${Date.now()}-${loadCounter++}`
  let module
  try {
    module = await import(url)
  } catch (err) {
    throw new Error(`Failed to import ${main}: ${err && err.stack ? err.stack : err}`)
  }

  const activate = module.activate || (module.default && module.default.activate)
  if (typeof activate !== 'function') {
    throw new Error(`${main} does not export an \`activate\` function.`)
  }

  const api = makeApi(id, record)
  const result = await activate(api)
  if (result && typeof result.dispose === 'function') record.disposers.push(() => result.dispose())
  if (typeof module.deactivate === 'function') record.disposers.push(() => module.deactivate())

  send({ t: 'loaded', pluginId: id, commands: Array.from(record.commands.keys()) })
}

async function disposePlugin(id) {
  const record = plugins.get(id)
  if (!record) return
  for (const dispose of record.disposers) {
    try {
      await dispose()
    } catch (err) {
      log(id, 'error', `deactivate failed: ${err && err.message ? err.message : err}`)
    }
  }
  plugins.delete(id)
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return

  switch (msg.t) {
    case 'load':
      try {
        await loadPlugin(msg.plugin)
      } catch (err) {
        send({
          t: 'load-error',
          pluginId: msg.plugin.id,
          error: err && err.stack ? err.stack : String(err),
        })
      }
      break

    case 'dispose':
      await disposePlugin(msg.pluginId)
      send({ t: 'disposed', pluginId: msg.pluginId })
      break

    case 'command': {
      const record = plugins.get(msg.pluginId)
      const handler = record && record.commands.get(msg.commandId)
      if (!handler) {
        send({ t: 'result', id: msg.id, ok: false, error: `No handler for command "${msg.commandId}".` })
        return
      }
      try {
        const value = await handler(msg.args)
        send({ t: 'result', id: msg.id, ok: true, value: serialisable(value) })
      } catch (err) {
        send({ t: 'result', id: msg.id, ok: false, error: err && err.stack ? err.stack : String(err) })
      }
      break
    }

    // The parent answering an rpc this host issued.
    case 'rpc-result': {
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      if (msg.ok) entry.resolve(msg.value)
      else entry.reject(new Error(msg.error || 'The editor rejected the request.'))
      break
    }
  }
})

/** Strips anything that would not survive the structured-clone hop. */
function serialisable(value) {
  if (value === undefined || value === null) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return String(value)
  }
}

// A plugin that throws asynchronously should be reported, not silently ignored,
// and must not bring the whole host — and every other plugin — down with it.
process.on('uncaughtException', (err) => {
  log('host', 'error', `Uncaught exception: ${err && err.stack ? err.stack : err}`)
})
process.on('unhandledRejection', (reason) => {
  log('host', 'error', `Unhandled rejection: ${reason && reason.stack ? reason.stack : reason}`)
})

send({ t: 'ready' })
