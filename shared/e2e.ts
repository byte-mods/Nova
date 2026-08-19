/**
 * Recording a browser session, and turning it into a test.
 *
 * Shared between the script injected into the browser pane, the renderer that
 * collects what it reports, and the code generator that writes it out.
 */

/** How an element was identified, worst to best. */
export type LocatorKind = 'testid' | 'role' | 'label' | 'placeholder' | 'text' | 'id' | 'css'

export interface Locator {
  kind: LocatorKind
  /** The value the locator matches on — a test id, a role name, a selector. */
  value: string
  /** The accessible name, for `role`. */
  name?: string
  /** True when this locator matched exactly one element when it was recorded. */
  unique: boolean
  /** Every candidate considered, best first, so the UI can offer alternatives. */
  alternatives?: Locator[]
}

export type RecordedAction =
  | { type: 'navigate'; url: string; at: number }
  | { type: 'click'; locator: Locator; at: number }
  | { type: 'fill'; locator: Locator; value: string; at: number }
  | { type: 'check'; locator: Locator; checked: boolean; at: number }
  | { type: 'select'; locator: Locator; value: string; at: number }
  | { type: 'press'; key: string; at: number }
  /** An assertion the user added by picking an element. */
  | { type: 'expectText'; locator: Locator; text: string; at: number }
  | { type: 'expectVisible'; locator: Locator; at: number }
  | { type: 'expectUrl'; url: string; at: number }

export interface RecordingState {
  recording: boolean
  /** Picker mode reports what is under the cursor without acting on it. */
  picking: boolean
  actions: RecordedAction[]
  /** What the picker last resolved, for the inspector. */
  inspected?: Locator
}

/* ---------------- visual regression ---------------- */

export interface VisualBaseline {
  name: string
  file: string
  width: number
  height: number
  at: number
}

export interface VisualComparison {
  name: string
  /** True when no baseline existed and this run created one. */
  created: boolean
  matched: boolean
  /** Pixels that differ beyond the tolerance. */
  changedPixels: number
  totalPixels: number
  /** Share of the image that changed, 0–1. */
  ratio: number
  /** Where the highlighted diff was written, when there was one. */
  diffFile?: string
  error?: string
}
