/**
 * Keyboard macros: record a sequence of keystrokes in the editor, replay it.
 *
 * Recording captures raw key events at the editor's DOM node rather than
 * Monaco commands, because commands do not exist for plain typing — and typing
 * is most of what a macro is. Playback re-dispatches the same events, which
 * routes them through Monaco's own keybinding service, so shortcuts recorded
 * into the macro (⌘D, ⌥↓, tab-through-snippet) do on replay exactly what they
 * did live.
 */

import { useStore } from '@/state/store'

export interface RecordedKey {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

interface MacroState {
  recording: boolean
  /** The keystrokes captured so far, or the last finished macro. */
  keys: RecordedKey[]
  target: HTMLElement | null
  listener: ((e: KeyboardEvent) => void) | null
}

const state: MacroState = { recording: false, keys: [], target: null, listener: null }

/** The last finished macro survives while the app runs. */
let lastMacro: RecordedKey[] = []

export function isRecording() {
  return state.recording
}

export function startRecording(target: HTMLElement): void {
  if (state.recording) return
  state.recording = true
  state.keys = []
  state.target = target
  state.listener = (event: KeyboardEvent) => {
    // The stop shortcut itself must not become part of the macro.
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === 'r') return
    state.keys.push({
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    })
  }
  target.addEventListener('keydown', state.listener, true)
  useStore.getState().notify('Recording macro — ⌥⌘R to stop.', 'info')
}

export function stopRecording(): void {
  if (!state.recording) return
  state.recording = false
  if (state.target && state.listener) {
    state.target.removeEventListener('keydown', state.listener, true)
  }
  lastMacro = state.keys
  state.target = null
  state.listener = null
  useStore
    .getState()
    .notify(`Macro recorded — ${lastMacro.length} keystroke(s). ⇧⌥⌘R plays it back.`, 'success')
}

export function toggleRecording(target: HTMLElement): void {
  if (state.recording) stopRecording()
  else startRecording(target)
}

/**
 * Replays the last macro.
 *
 * Plain typing cannot be replayed as synthetic key events — Monaco reads text
 * from its hidden textarea's input events, not from keydown — so printable
 * keys go through the `type` callback (which calls `editor.trigger('type')`),
 * and everything else is re-dispatched as a keydown for the keybinding service
 * to resolve exactly as it did live. One event per tick, so widgets opened by
 * one keystroke exist before the next arrives.
 */
export async function playMacro(
  target: HTMLElement,
  type: (text: string) => void,
  times = 1,
): Promise<void> {
  if (state.recording) stopRecording()
  if (lastMacro.length === 0) {
    useStore.getState().notify('No macro recorded yet — ⌥⌘R starts recording.', 'error')
    return
  }
  for (let round = 0; round < times; round++) {
    for (const key of lastMacro) {
      const printable = key.key.length === 1 && !key.ctrlKey && !key.metaKey && !key.altKey
      if (printable) {
        type(key.key)
      } else {
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: key.key,
            code: key.code,
            ctrlKey: key.ctrlKey,
            metaKey: key.metaKey,
            altKey: key.altKey,
            shiftKey: key.shiftKey,
            bubbles: true,
            cancelable: true,
          }),
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
}

export function hasMacro(): boolean {
  return lastMacro.length > 0
}
