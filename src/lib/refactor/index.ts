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
export * from './rename'
export * from './classes'
export * from './encapsulate'

export interface RefactorDescriptor {
  id: RefactorId
  label: string
  /** Shown in menus; matches the IntelliJ default keymap. */
  shortcut: string
  /** Needs a non-empty selection rather than just a caret. */
  needsSelection: boolean
  group: 'rename' | 'extract' | 'inline' | 'move' | 'signature' | 'delete' | 'members' | 'convert'
}

export const REFACTORINGS: RefactorDescriptor[] = [
  { id: 'rename', label: 'Rename…', shortcut: '⇧F6', needsSelection: false, group: 'rename' },
  { id: 'rename.file', label: 'Rename File…', shortcut: '', needsSelection: false, group: 'rename' },
  { id: 'rename.directory', label: 'Rename Directory / Package…', shortcut: '', needsSelection: false, group: 'rename' },
  { id: 'extract.variable', label: 'Extract Variable…', shortcut: '⌥⌘V', needsSelection: true, group: 'extract' },
  { id: 'extract.constant', label: 'Extract Constant…', shortcut: '⌥⌘C', needsSelection: true, group: 'extract' },
  { id: 'extract.field', label: 'Extract Field…', shortcut: '⌥⌘F', needsSelection: true, group: 'extract' },
  { id: 'extract.method', label: 'Extract Method…', shortcut: '⌥⌘M', needsSelection: true, group: 'extract' },
  { id: 'extract.parameter', label: 'Extract Parameter…', shortcut: '⌥⌘P', needsSelection: true, group: 'extract' },
  { id: 'extract.interface', label: 'Extract Interface…', shortcut: '', needsSelection: false, group: 'extract' },
  { id: 'extract.superclass', label: 'Extract Superclass…', shortcut: '', needsSelection: false, group: 'extract' },
  { id: 'inline.variable', label: 'Inline Variable…', shortcut: '⌥⌘N', needsSelection: false, group: 'inline' },
  { id: 'inline.method', label: 'Inline Method…', shortcut: '', needsSelection: false, group: 'inline' },
  { id: 'inline.parameter', label: 'Inline Parameter…', shortcut: '', needsSelection: false, group: 'inline' },
  { id: 'inline.field', label: 'Inline Field…', shortcut: '', needsSelection: false, group: 'inline' },
  { id: 'signature.change', label: 'Change Signature…', shortcut: '⌘F6', needsSelection: false, group: 'signature' },
  { id: 'signature.parameterObject', label: 'Introduce Parameter Object…', shortcut: '', needsSelection: false, group: 'signature' },
  { id: 'encapsulate.field', label: 'Encapsulate Field…', shortcut: '', needsSelection: false, group: 'signature' },
  { id: 'invert.boolean', label: 'Invert Boolean…', shortcut: '', needsSelection: false, group: 'convert' },
  { id: 'convert.anonymous', label: 'Convert Anonymous to Inner…', shortcut: '', needsSelection: false, group: 'convert' },
  { id: 'move.file', label: 'Move File…', shortcut: 'F6', needsSelection: false, group: 'move' },
  { id: 'move.class', label: 'Move Class…', shortcut: '', needsSelection: false, group: 'move' },
  { id: 'members.pullUp', label: 'Pull Members Up…', shortcut: '', needsSelection: false, group: 'members' },
  { id: 'members.pushDown', label: 'Push Members Down…', shortcut: '', needsSelection: false, group: 'members' },
  { id: 'safeDelete', label: 'Safe Delete…', shortcut: '⌘⌫', needsSelection: false, group: 'delete' },
]

/**
 * Refactorings that only move or delete text, and so need no language profile.
 * Rename is one of them: it rewrites an identifier it found by masking, and
 * masking has a generic fallback.
 */
const PROFILE_FREE = new Set<RefactorId>([
  'rename',
  'rename.file',
  'rename.directory',
  'move.file',
  'safeDelete',
])

/**
 * Which refactorings make sense right here.
 *
 * Rename, Move File and Safe Delete work on any text file, so they survive a
 * missing language profile; everything else needs one, because it writes new
 * code.
 */
export function availableRefactorings(
  site: Pick<RefactorSite, 'language'>,
  hasSelection: boolean,
): { descriptor: RefactorDescriptor; enabled: boolean; reason: string }[] {
  const profile = profileFor(site.language)
  return REFACTORINGS.map((descriptor) => {
    const alwaysAvailable = PROFILE_FREE.has(descriptor.id)
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
