/**
 * The renderer half of the plugin bridge.
 *
 * Two jobs. It mirrors main-process plugin state into the store, and it answers
 * the questions a plugin asks about things only the renderer knows — which file
 * is active, what is selected, what the user says to a prompt.
 *
 * It lives in `App` because a plugin may call `editor.activeFile()` at any
 * moment, including while the Plugins view is closed. Mounting the bridge with
 * the view would make the API's availability depend on what the user happens to
 * be looking at.
 */
import { useEffect } from 'react'
import { useStore } from '@/state/store'
import { languageForPath } from '@/lib/language'

export function usePluginEvents() {
  useEffect(() => {
    const store = () => useStore.getState()

    const unsubList = window.nova.plugins.onList((plugins) => useStore.setState({ plugins }))
    const unsubRuntime = window.nova.plugins.onRuntime((pluginRuntime) =>
      useStore.setState({ pluginRuntime }),
    )
    const unsubLog = window.nova.plugins.onLog((event) => store().appendPluginLog(event))
    const unsubProgress = window.nova.plugins.onInstallProgress((p) => store().setPluginInstall(p))
    const unsubView = window.nova.plugins.onViewHtml(({ pluginId, viewId, html }) =>
      store().setPluginViewHtml(pluginId, viewId, html),
    )
    const unsubLoadError = window.nova.plugins.onLoadError(({ pluginId, error }) => {
      store().notify(`${pluginId} failed to load: ${error.split('\n')[0]}`, 'error')
    })

    const unsubAsk = window.nova.plugins.onAsk(async ({ id, question, params }) => {
      try {
        const value = await answer(question, params as Record<string, unknown>)
        window.nova.plugins.answer(id, true, value)
      } catch (err) {
        window.nova.plugins.answer(id, false, undefined, err instanceof Error ? err.message : String(err))
      }
    })

    void store().refreshPlugins()

    return () => {
      unsubList()
      unsubRuntime()
      unsubLog()
      unsubProgress()
      unsubView()
      unsubLoadError()
      unsubAsk()
    }
  }, [])
}

/** Publishes the open project to the plugin host whenever it changes. */
export function usePluginWorkspaceRoot(root: string | null) {
  useEffect(() => {
    void window.nova.plugins.setRoot(root)
  }, [root])
}

async function answer(question: string, params: Record<string, unknown>): Promise<unknown> {
  const store = useStore.getState()

  switch (question) {
    case 'editor.activeFile': {
      const tab = store.tabs.find((t) => t.id === store.activeTabId)
      return tab?.path ?? null
    }

    case 'editor.selection': {
      const tab = store.tabs.find((t) => t.id === store.activeTabId)
      if (!tab?.path) return null
      const buffer = store.buffers[tab.path]
      return {
        file: tab.path,
        language: languageForPath(tab.path),
        text: buffer?.content ?? '',
        cursor: store.cursor,
      }
    }

    case 'editor.open': {
      const file = String(params.file ?? '')
      if (!file) throw new Error('editor.open needs a file.')
      const line = Number(params.line)
      await store.openFile(file, Number.isFinite(line) && line > 0 ? { line } : undefined)
      return null
    }

    case 'editor.applyEdit': {
      const file = String(params.file ?? '')
      const edit = params.edit as { text?: string } | undefined
      if (!file || typeof edit?.text !== 'string') {
        throw new Error('editor.applyEdit needs a file and edit.text.')
      }
      if (!store.buffers[file]) throw new Error(`${file} is not open, so it cannot be edited.`)
      // Whole-buffer replacement is the only edit shape v1 accepts: a partial
      // range edit needs to be rebased against edits the user made while the
      // plugin was thinking, and getting that wrong silently corrupts a file.
      store.updateBuffer(file, edit.text)
      return null
    }

    case 'ui.showMessage': {
      const kind = String(params.kind ?? 'info')
      store.notify(String(params.text ?? ''), kind === 'error' ? 'error' : kind === 'warn' ? 'error' : 'info')
      return null
    }

    case 'ui.prompt': {
      const choices = Array.isArray(params.choices) ? (params.choices as string[]) : []
      const question_ = String(params.question ?? '')
      // `confirm` for a yes/no, `prompt` for anything freer. Modest, but it is a
      // real answer rather than a stub that always resolves null.
      if (choices.length === 2) return confirm(`${question_}\n\nOK = ${choices[0]}`) ? choices[0] : choices[1]
      const typed = window.prompt(question_, choices[0] ?? '')
      return typed
    }

    case 'workspace.findFiles': {
      const root = store.root
      if (!root) throw new Error('No project is open.')
      return window.nova.fs.findFiles(root, String(params.query ?? ''), Number(params.limit) || 50)
    }

    case 'workspace.search': {
      const root = store.root
      if (!root) throw new Error('No project is open.')
      return window.nova.fs.search(root, String(params.query ?? ''), params.options)
    }

    case 'commands.execute': {
      const commandId = String(params.commandId ?? '')
      const { appActions } = await import('@/lib/actions')
      const action = appActions().find((a) => a.id === commandId)
      if (!action) throw new Error(`No such command: "${commandId}".`)
      action.run()
      return null
    }

    default:
      throw new Error(`The editor cannot answer "${question}".`)
  }
}
