/**
 * Scratch files.
 *
 * A scratch is an ordinary file in `~/.nova/scratches` — once created it opens
 * in the normal editor with full code intelligence, which is the IntelliJ
 * behaviour that makes scratches useful rather than a separate toy buffer.
 * This tab is the manager: create with a language, reopen, delete.
 */

import { useEffect, useState } from 'react'
import { FilePlus2, Trash2 } from 'lucide-react'
import type { Tab } from '@/state/store'
import { useStore } from '@/state/store'
import { fileIcon } from '@/lib/fileIcons'
import { formatBytes } from '@/lib/paths'

const LANGUAGES: { label: string; extension: string }[] = [
  { label: 'Text', extension: 'txt' },
  { label: 'TypeScript', extension: 'ts' },
  { label: 'JavaScript', extension: 'js' },
  { label: 'JSON', extension: 'json' },
  { label: 'Python', extension: 'py' },
  { label: 'Go', extension: 'go' },
  { label: 'Rust', extension: 'rs' },
  { label: 'Java', extension: 'java' },
  { label: 'Kotlin', extension: 'kt' },
  { label: 'SQL', extension: 'sql' },
  { label: 'Shell', extension: 'sh' },
  { label: 'Markdown', extension: 'md' },
  { label: 'HTML', extension: 'html' },
  { label: 'CSS', extension: 'css' },
  { label: 'YAML', extension: 'yaml' },
  { label: 'HTTP request', extension: 'http' },
]

async function scratchDir(): Promise<string> {
  const home = await window.nova.app.homeDir()
  return `${home}/.nova/scratches`
}

/** Creates `scratch_N.ext`, skipping names that already exist. */
export async function newScratchFile(extension: string): Promise<void> {
  const dir = await scratchDir()
  const existing = await window.nova.fs.list(dir).catch(() => [])
  const taken = new Set(existing.map((entry) => entry.name))
  let name = `scratch.${extension}`
  for (let i = 2; taken.has(name); i++) name = `scratch_${i}.${extension}`
  const path = `${dir}/${name}`
  await window.nova.fs.create(path, false)
  await useStore.getState().openFile(path)
}

export default function ScratchView(_props: { tab: Tab }) {
  const iconPack = useStore((s) => s.settings.iconPack)
  const [files, setFiles] = useState<{ name: string; path: string; size?: number }[]>([])
  const [extension, setExtension] = useState('ts')

  const refresh = async () => {
    const dir = await scratchDir()
    const entries = await window.nova.fs.list(dir).catch(() => [])
    setFiles(entries.filter((entry) => !entry.isDirectory))
  }

  useEffect(() => {
    void refresh()
  }, [])

  return (
    <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
      <h2 style={{ marginTop: 0 }}>Scratch files</h2>
      <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 560 }}>
        Scratches live outside the project, survive it being closed, and get full editor
        intelligence for their language. Use them for throwaway queries, snippets under test, or
        notes that should not end up in git.
      </p>

      <div className="row" style={{ gap: 8, margin: '14px 0' }}>
        <select className="select" value={extension} onChange={(e) => setExtension(e.target.value)}>
          {LANGUAGES.map((language) => (
            <option key={language.extension} value={language.extension}>
              {language.label}
            </option>
          ))}
        </select>
        <button
          className="btn primary"
          onClick={async () => {
            await newScratchFile(extension)
            await refresh()
          }}
        >
          <FilePlus2 size={13} /> New scratch
        </button>
      </div>

      {files.length === 0 && <div className="faint">No scratches yet.</div>}
      <div style={{ display: 'grid', gap: 2, maxWidth: 560 }}>
        {files.map((file) => {
          const { Icon, color } = fileIcon(file.path, iconPack)
          return (
            <div key={file.path} className="tree-row" style={{ paddingLeft: 8 }}>
              <Icon size={14} style={{ color, flexShrink: 0 }} />
              <button
                className="tree-label"
                style={{ textAlign: 'left', flex: 1 }}
                onClick={() => void useStore.getState().openFile(file.path)}
              >
                {file.name}
              </button>
              <span className="faint" style={{ fontSize: 10.5 }}>{formatBytes(file.size ?? 0)}</span>
              <button
                className="icon-btn"
                style={{ width: 20, height: 20 }}
                title="Move to Trash"
                onClick={async () => {
                  await window.nova.fs.trash(file.path)
                  useStore.getState().closeTab(`file:${file.path}`)
                  await refresh()
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
