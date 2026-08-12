import { useEffect } from 'react'
import type { AiEvent } from '@shared/types'
import { useStore } from '@/state/store'

/**
 * Routes agent stream events belonging to an Explain run into its document.
 *
 * This lives in `App` rather than in `ExplainView` on purpose: the run should
 * keep streaming while the user is on another tab, and finish even if they
 * close the walkthrough and reopen it later.
 */
export function useExplainEvents() {
  useEffect(() => {
    const unsubscribe = window.nova.ai.onEvent((raw) => {
      const event = raw as AiEvent
      const store = useStore.getState()
      const owned = Object.values(store.explain).some((doc) => doc.runId === event.runId)
      if (!owned) return

      switch (event.type) {
        case 'assistant-text':
          store.patchExplain(event.runId, (doc) => ({ ...doc, content: doc.content + event.text }))
          return
        case 'thinking':
          store.patchExplain(event.runId, (doc) => ({ ...doc, thinking: doc.thinking + event.text }))
          return
        case 'error':
          store.patchExplain(event.runId, (doc) => ({
            ...doc,
            status: 'error',
            error: event.message,
            finishedAt: Date.now(),
          }))
          return
        case 'done':
          store.patchExplain(event.runId, (doc) => ({
            ...doc,
            // A run that produced nothing is a failure even when it exits ok.
            status: event.ok || doc.content.trim() ? 'done' : 'error',
            error: doc.content.trim() ? doc.error : 'The agent returned nothing.',
            finishedAt: Date.now(),
          }))
          return
        default:
          // Tool calls and file-change events belong to the console, not here.
          return
      }
    })
    return unsubscribe
  }, [])
}
