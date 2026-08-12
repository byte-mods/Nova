/**
 * The refactoring registry — one entry per refactoring, describing what it is
 * called, how it is bound and when it applies. `RefactorThis` (⌃T) renders
 * this list; the command palette and the editor context menu read the same
 * entries, so there is one place to add a refactoring.
 */

import { profileFor } from './profiles'
import type { RefactorId, RefactorSite } from './types'

export * from './types'
export * from './profiles'
export * from './syntax'
export * from './naming'
export * from './params'
export * from './context'
export * from './extract'
export * from './inline'
export * from './signature'
export * from './safeDelete'
export * from './members'
export * from './move'

export interface RefactorDescriptor {
  id: RefactorId
  label: string
  /** Shown in menus; matches the IntelliJ default keymap. */
  shortcut: string
  /** Needs a non-empty selection rather than just a caret. */
  needsSelection: boolean
  group: 'extract' | 'inline' | 'move' | 'signature' | 'delete' | 'members'
}

export const REFACTORINGS: RefactorDescriptor[] = [
  { id: 'extract.variable', label: 'Extract Variable…', shortcut: '⌥⌘V', needsSelection: true, group: 'extract' },
  { id: 'extract.constant', label: 'Extract Constant…', shortcut: '⌥⌘C', needsSelection: true, group: 'extract' },
  { id: 'extract.field', label: 'Extract Field…', shortcut: '⌥⌘F', needsSelection: true, group: 'extract' },
  { id: 'extract.method', label: 'Extract Method…', shortcut: '⌥⌘M', needsSelection: true, group: 'extract' },
  { id: 'extract.parameter', label: 'Extract Parameter…', shortcut: '⌥⌘P', needsSelection: true, group: 'extract' },
  { id: 'inline.variable', label: 'Inline Variable…', shortcut: '⌥⌘N', needsSelection: false, group: 'inline' },
  { id: 'inline.method', label: 'Inline Method…', shortcut: '', needsSelection: false, group: 'inline' },
  { id: 'signature.change', label: 'Change Signature…', shortcut: '⌘F6', needsSelection: false, group: 'signature' },
  { id: 'signature.parameterObject', label: 'Introduce Parameter Object…', shortcut: '', needsSelection: false, group: 'signature' },
  { id: 'move.file', label: 'Move File…', shortcut: 'F6', needsSelection: false, group: 'move' },
  { id: 'move.class', label: 'Move Class…', shortcut: '', needsSelection: false, group: 'move' },
  { id: 'members.pullUp', label: 'Pull Members Up…', shortcut: '', needsSelection: false, group: 'members' },
  { id: 'members.pushDown', label: 'Push Members Down…', shortcut: '', needsSelection: false, group: 'members' },
  { id: 'safeDelete', label: 'Safe Delete…', shortcut: '⌘⌫', needsSelection: false, group: 'delete' },
]

/**
 * Which refactorings make sense right here.
 *
 * Move File and Safe Delete work on any text file, so they survive a missing
 * language profile; everything else needs one, because it writes new code.
 */
export function availableRefactorings(
  site: Pick<RefactorSite, 'language'>,
  hasSelection: boolean,
): { descriptor: RefactorDescriptor; enabled: boolean; reason: string }[] {
  const profile = profileFor(site.language)
  return REFACTORINGS.map((descriptor) => {
    const alwaysAvailable = descriptor.id === 'move.file' || descriptor.id === 'safeDelete'
    if (!profile && !alwaysAvailable) {
      return {
        descriptor,
        enabled: false,
        reason: `not supported for ${site.language || 'this file type'}`,
      }
    }
    if (descriptor.needsSelection && !hasSelection) {
      return { descriptor, enabled: false, reason: 'select an expression or statements first' }
    }
    return { descriptor, enabled: true, reason: '' }
  })
}
