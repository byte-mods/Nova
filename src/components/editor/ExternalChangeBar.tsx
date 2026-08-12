import { AlertTriangle, GitCompare, RefreshCw, X } from 'lucide-react'
import { useStore } from '@/state/store'

/**
 * Shown when a file changed on disk while its buffer had unsaved edits.
 *
 * Nova never overwrites what the user typed, but staying silent about the
 * divergence is worse: the next ⌘S quietly discards whatever the other writer
 * did. This makes it a choice.
 */
export default function ExternalChangeBar({ path }: { path: string }) {
  const change = useStore((s) => s.externalChanges[path])
  if (!change) return null

  const resolve = (action: 'reload' | 'keep' | 'compare') =>
    void useStore.getState().resolveExternalChange(path, action)

  return (
    <div className="external-change">
      <AlertTriangle size={13} />
      <span>
        This file changed on disk while you had unsaved edits. Saving now will
        overwrite the version on disk.
      </span>
      <span style={{ flex: 1 }} />
      <button className="btn sm" onClick={() => resolve('compare')}>
        <GitCompare size={12} /> Compare
      </button>
      <button className="btn sm" onClick={() => resolve('reload')} title="Discard your edits and load the version on disk">
        <RefreshCw size={12} /> Reload from disk
      </button>
      <button className="btn sm ghost" onClick={() => resolve('keep')} title="Keep your version">
        <X size={12} /> Keep mine
      </button>
    </div>
  )
}
