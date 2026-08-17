import { useEffect } from 'react'
import type { AiEvent } from '@shared/types'
import { useStore } from '@/state/store'

/**
 * Routes agent stream events belonging to an Explain run — or to the
 * project-wide Tutorial run — into their document.
 *
 * This lives in `App` rather than in `ExplainView` on purpose: the run should
 * keep streaming while the user is on another tab, and finish even if they
 * close the walkthrough and reopen it later. That matters more for the tutorial
 * than for a single file: it is a long document, and the reader is expected to
 * carry on working while it is written.
 */
export function useExplainEvents() {
  useEffect(() => {
    const unsubscribe = window.nova.ai.onEvent((raw) => {
      const event = raw as AiEvent
      const store = useStore.getState()

      // The tutorial is one document rather than a map, so it is matched first
      // and separately; the two never share a runId.
      if (store.tutorial?.runId === event.runId) {
        switch (event.type) {
          case 'assistant-text':
            store.patchTutorial(event.runId, (doc) => ({ ...doc, content: doc.content + event.text }))
            return
          case 'thinking':
            store.patchTutorial(event.runId, (doc) => ({
              ...doc,
              thinking: doc.thinking + event.text,
            }))
            return
          case 'error':
            store.patchTutorial(event.runId, (doc) => ({
              ...doc,
              status: 'error',
              error: event.message,
              finishedAt: Date.now(),
            }))
            return
          case 'done':
            store.patchTutorial(event.runId, (doc) => ({
              ...doc,
              status: event.ok || doc.content.trim() ? 'done' : 'error',
              error: doc.content.trim() ? doc.error : 'The agent returned nothing.',
              finishedAt: Date.now(),
            }))
            return
          default:
            return
        }
      }

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
