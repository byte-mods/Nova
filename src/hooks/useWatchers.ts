import { useEffect } from 'react'
import { useStore } from '@/state/store'

/**
 * Keeps the tree, git status and open buffers in sync with on-disk changes —
 * including edits the AI console makes underneath us.
 */
export function useWatchers() {
  useEffect(() => {
    let treeTimer: ReturnType<typeof setTimeout> | undefined
    let gitTimer: ReturnType<typeof setTimeout> | undefined
    const touched = new Set<string>()

    const unsubscribe = window.nova.fs.onChanged(({ path }) => {
      touched.add(path)

      clearTimeout(treeTimer)
      treeTimer = setTimeout(() => {
        useStore.getState().bumpTree()

        const { buffers } = useStore.getState()
        for (const path of touched) {
          const buffer = buffers[path]
          // Never clobber unsaved edits; the tab keeps the user's version.
          if (buffer && buffer.content === buffer.savedContent) {
            void useStore.getState().reloadBuffer(path)
          }
        }
        touched.clear()
      }, 220)

      clearTimeout(gitTimer)
      gitTimer = setTimeout(() => {
        void useStore.getState().refreshGit()
      }, 600)
    })

    return () => {
      unsubscribe()
      clearTimeout(treeTimer)
      clearTimeout(gitTimer)
    }
  }, [])

  useEffect(() => {
    // The indexer streams progress while it walks a project.
    return window.nova.code.onStatus((status) => {
      useStore.getState().setIndexStatus(status)
    })
  }, [])

  useEffect(() => {
    const offState = window.nova.debug.onState((state) => {
      useStore.getState().setDebugState(state)
    })
    const offOutput = window.nova.debug.onOutput(({ text }) => {
      useStore.getState().appendDebugOutput(text)
    })
    const offStopped = window.nova.debug.onStopped(() => {
      const state = useStore.getState().debug.state
      const frame = state?.frames.find((f) => f.id === state.currentFrameId)
      // Bring the paused location on screen, the way a debugger should.
      if (frame?.file) {
        void useStore.getState().openFile(frame.file, { line: frame.line, column: frame.column })
      }
    })
    void window.nova.debug.detect().then(() => useStore.getState().detectDebugAdapters())
    return () => {
      offState()
      offOutput()
      offStopped()
    }
  }, [])

  useEffect(() => {
    return window.nova.tests.onUpdate((update) => {
      useStore.getState().applyTestEvents(update)
    })
  }, [])

  useEffect(() => {
    const off = window.nova.lsp.onStatus((servers) => {
      useStore.getState().setLspServers(servers)
    })
    void window.nova.lsp.detect().then((servers) => useStore.getState().setLspServers(servers))
    return off
  }, [])

  useEffect(() => {
    void window.nova.ai.providers().then((providers) => {
      useStore.getState().setProviders(providers)
      const preferred = useStore.getState().settings.aiProvider
      const active = providers.find((p) => p.id === preferred)
      if (!active?.available) {
        const fallback = providers.find((p) => p.available)
        if (fallback) useStore.getState().setSettings({ aiProvider: fallback.id })
      }
    })
  }, [])
}
