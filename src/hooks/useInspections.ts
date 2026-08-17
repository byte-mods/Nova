/**
 * Keeps inspection markers in step with what is being edited.
 *
 * Runs debounced against the *model* rather than the store buffer so that
 * markers update while typing, not only on save — an inspection you only see
 * after saving is one you have already stopped thinking about.
 */
import { useEffect } from 'react'
import { monaco } from '@/lib/monacoSetup'
import { useStore } from '@/state/store'
import { clearInspections, inspect, registerInspectionCodeActions } from '@/lib/inspections'

/** Long enough to not run on every keystroke, short enough to feel live. */
const DEBOUNCE_MS = 350

export function useInspections() {
  const profile = useStore((s) => s.settings.inspectionProfile)
  const enabled = useStore((s) => s.settings.inspectionsEnabled)

  useEffect(() => {
    if (!enabled) {
      for (const model of monaco.editor.getModels()) clearInspections(model)
      return
    }

    const timers = new Map<string, ReturnType<typeof setTimeout>>()
    const disposables: { dispose: () => void }[] = [registerInspectionCodeActions()]

    const schedule = (model: monaco.editor.ITextModel) => {
      const key = model.uri.toString()
      const existing = timers.get(key)
      if (existing) clearTimeout(existing)
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          if (!model.isDisposed()) inspect(model, profile)
        }, DEBOUNCE_MS),
      )
    }

    const attach = (model: monaco.editor.ITextModel) => {
      inspect(model, profile)
      disposables.push(model.onDidChangeContent(() => schedule(model)))
    }

    for (const model of monaco.editor.getModels()) attach(model)
    disposables.push(monaco.editor.onDidCreateModel(attach))
    disposables.push(
      monaco.editor.onWillDisposeModel((model) => {
        const key = model.uri.toString()
        const timer = timers.get(key)
        if (timer) clearTimeout(timer)
        timers.delete(key)
      }),
    )

    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      for (const d of disposables) d.dispose()
    }
  }, [profile, enabled])
}
