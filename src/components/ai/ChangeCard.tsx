import { FilePlus2, FileX2, GitCompareArrows, Undo2 } from 'lucide-react'
import type { FileChange } from '@shared/types'
import { useStore } from '@/state/store'
import { basename, relative } from '@/lib/paths'
import { fileIcon } from '@/lib/fileIcons'
import { openChangeDiff } from './AiConsole'

/** One file the assistant touched, with inline review and revert. */
export default function ChangeCard({ change, root }: { change: FileChange; root: string }) {
  const iconPack = useStore((s) => s.settings.iconPack)
  const { Icon, color } = fileIcon(change.path, iconPack)

  const KindIcon = change.kind === 'create' ? FilePlus2 : change.kind === 'delete' ? FileX2 : Icon

  return (
    <div className="change-card">
      <KindIcon size={14} style={{ color: change.kind === 'create' ? 'var(--added)' : color, flexShrink: 0 }} />
      <div className="change-meta">
        <span className="change-name">{basename(change.path)}</span>
        <span className="faint change-path">{relative(root, change.path)}</span>
      </div>
      <span className="change-stat added">+{change.additions}</span>
      <span className="change-stat removed">−{change.deletions}</span>
      <button
        className="icon-btn"
        title="Review diff in the editor"
        onClick={() => openChangeDiff(change, root)}
      >
        <GitCompareArrows size={14} />
      </button>
      <button
        className="icon-btn"
        title="Revert this file to its previous content"
        onClick={async () => {
          if (change.kind === 'create') {
            await window.nova.fs.trash(change.path)
            useStore.getState().closeTab(`file:${change.path}`)
          } else {
            await window.nova.fs.write(change.path, change.before)
            await useStore.getState().reloadBuffer(change.path)
          }
          await useStore.getState().refreshGit()
          useStore.getState().bumpTree()
          useStore.getState().notify(`Reverted ${basename(change.path)}`, 'success')
        }}
      >
        <Undo2 size={14} />
      </button>
    </div>
  )
}
