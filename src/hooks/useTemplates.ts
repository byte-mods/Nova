/**
 * Registers live templates with Monaco, and applies code style on save.
 *
 * The provider is registered once and reads the template list through a getter,
 * so editing a user template takes effect on the next keystroke instead of
 * requiring a reload.
 */
import { useEffect } from 'react'
import { useStore } from '@/state/store'
import { BUILTIN_TEMPLATES, registerTemplates, type LiveTemplate } from '@/lib/templates'

export function useTemplates() {
  useEffect(() => {
    const disposable = registerTemplates(() => {
      const user = useStore.getState().settings.userTemplates ?? []
      // A user template with the same abbreviation wins, so a built-in can be
      // overridden without having to disable it.
      const overridden = new Set(user.map((t) => t.abbreviation))
      return [...user, ...BUILTIN_TEMPLATES.filter((t) => !overridden.has(t.abbreviation))]
    })
    return () => disposable.dispose()
  }, [])
}

export type { LiveTemplate }
