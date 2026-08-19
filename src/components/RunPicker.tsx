import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Play, Plus } from 'lucide-react'
import type { RunConfig } from '@shared/types'
import { useStore } from '@/state/store'

/** Run configurations: detected from the project, plus `.nova/run.json`. */
export default function RunPicker() {
  const root = useStore((s) => s.root)
  const treeVersion = useStore((s) => s.treeVersion)
  const [configs, setConfigs] = useState<RunConfig[]>([])
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!root) return
    void window.nova.shell.runConfigs(root).then((result) => {
      setConfigs(result)
      setSelected((current) => current ?? result[0]?.id ?? null)
    })
  }, [root, treeVersion])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  if (!root || configs.length === 0) return null

  const active = configs.find((c) => c.id === selected) ?? configs[0]

  const run = (config: RunConfig) => {
    setSelected(config.id)
    setOpen(false)
    useStore.getState().showPanel('terminal')
    // Give the terminal a beat to mount before handing it a command.
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('nova:run-command', { detail: { command: config.command } }),
      )
    }, 120)
  }

  return (
    <div className="run-picker" ref={ref}>
      <button className="btn ghost sm" title={active.command} onClick={() => run(active)}>
        <Play size={12} style={{ color: 'var(--success)' }} />
        <span className="run-label">{active.label}</span>
      </button>
      <button
        className="icon-btn"
        style={{ width: 20 }}
        title="Pick another run configuration"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown size={13} />
      </button>

      {open && (
        <div className="run-menu fade-in">
          {configs.map((config) => (
            <button
              key={config.id}
              className={`context-item ${config.id === active.id ? 'active' : ''}`}
              onClick={() => run(config)}
            >
              <Play size={11} style={{ color: 'var(--success)', flexShrink: 0 }} />
              <span style={{ display: 'grid', gap: 1, minWidth: 0, textAlign: 'left' }}>
                <span>{config.label}</span>
                {config.detail && (
                  <span className="faint mono" style={{ fontSize: 10 }}>
                    {config.detail}
                  </span>
                )}
              </span>
              {config.source === 'custom' && <span className="chip" style={{ height: 15 }}>custom</span>}
            </button>
          ))}
          <div className="context-sep" />
          <button
            className="context-item"
            onClick={() => {
              setOpen(false)
              useStore.getState().openTab({ id: 'runconfigs', kind: 'runconfigs', title: 'Run Configurations' })
            }}
          >
            <Plus size={11} />
            Edit run configurations…
          </button>
        </div>
      )}
    </div>
  )
}
