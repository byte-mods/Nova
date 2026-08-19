/**
 * The run configuration editor — a GUI over `.nova/run.json`.
 *
 * Everything the backend composes into the final command line is editable
 * here: command, arguments, environment, working directory, before-launch
 * steps and compound membership. The file stays hand-editable; this is just
 * the version of it with fields instead of syntax.
 */

import { useEffect, useState } from 'react'
import { Check, Copy, Play, Plus, Trash2 } from 'lucide-react'
import type { RunConfigEntry } from '@shared/types'
import { useStore } from '@/state/store'

export default function RunConfigsView() {
  const root = useStore((s) => s.root)
  const [entries, setEntries] = useState<RunConfigEntry[]>([])
  const [selected, setSelected] = useState(0)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!root) return
    void window.nova.shell.runConfigEntries(root).then((result) => {
      setEntries(result)
      setSelected(0)
      setDirty(false)
    })
  }, [root])

  if (!root) return <div className="empty-state">Open a project first.</div>

  const entry = entries[selected]

  const update = (patch: Partial<RunConfigEntry>) => {
    setEntries((current) => current.map((e, i) => (i === selected ? { ...e, ...patch } : e)))
    setDirty(true)
  }

  const save = async () => {
    await window.nova.shell.saveRunConfigEntries(root, entries)
    setDirty(false)
    useStore.getState().notify('Run configurations saved to .nova/run.json', 'success')
    useStore.getState().bumpTree()
  }

  const add = (compound: boolean) => {
    const name = compound ? `Compound ${entries.length + 1}` : `Configuration ${entries.length + 1}`
    setEntries((current) => [
      ...current,
      compound ? { name, compound: [] } : { name, command: '', args: '', env: {}, before: [] },
    ])
    setSelected(entries.length)
    setDirty(true)
  }

  const runNow = async () => {
    if (!entry) return
    await save()
    const configs = await window.nova.shell.runConfigs(root)
    const config = configs.find((c) => c.id === `custom:${entry.name}`)
    if (!config) return
    useStore.getState().showPanel('terminal')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('nova:run-command', { detail: { command: config.command } }))
    }, 120)
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <div style={{ width: 240, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ padding: 8, gap: 6 }}>
          <button className="btn sm" onClick={() => add(false)}>
            <Plus size={12} /> Config
          </button>
          <button className="btn sm" onClick={() => add(true)} title="Runs several configurations in parallel">
            <Copy size={12} /> Compound
          </button>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {entries.map((e, index) => (
            <button
              key={index}
              className={`tree-row ${index === selected ? 'selected' : ''}`}
              style={{ width: '100%', paddingLeft: 12 }}
              onClick={() => setSelected(index)}
            >
              <Play size={12} style={{ color: e.compound ? 'var(--info, var(--accent))' : 'var(--success)' }} />
              <span className="tree-label">{e.name}</span>
            </button>
          ))}
          {entries.length === 0 && (
            <div className="faint" style={{ padding: 12, fontSize: 11.5, lineHeight: 1.6 }}>
              No custom configurations yet. Detected ones (npm scripts, cargo, make…) appear in the
              run picker automatically; add one here for anything with arguments, env or
              before-launch steps.
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {!entry && <div className="faint">Select or create a configuration.</div>}
        {entry && (
          <div style={{ display: 'grid', gap: 12, maxWidth: 640 }}>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary sm" disabled={!dirty} onClick={() => void save()}>
                <Check size={12} /> Save
              </button>
              <button className="btn sm" onClick={() => void runNow()}>
                <Play size={12} /> Save and run
              </button>
              <span style={{ flex: 1 }} />
              <button
                className="btn sm"
                onClick={() => {
                  setEntries((current) => current.filter((_e, i) => i !== selected))
                  setSelected(0)
                  setDirty(true)
                }}
              >
                <Trash2 size={12} /> Delete
              </button>
            </div>

            <label className="field">
              <span>Name</span>
              <input value={entry.name} onChange={(e) => update({ name: e.target.value })} />
            </label>

            {entry.compound ? (
              <div className="field">
                <span>Members — run in parallel, the run finishes when all do</span>
                <div style={{ display: 'grid', gap: 4 }}>
                  {entries
                    .filter((_e, i) => i !== selected)
                    .map((other) => (
                      <label key={other.name} className="refactor-check">
                        <input
                          type="checkbox"
                          checked={entry.compound!.includes(other.name)}
                          onChange={(e) =>
                            update({
                              compound: e.target.checked
                                ? [...entry.compound!, other.name]
                                : entry.compound!.filter((name) => name !== other.name),
                            })
                          }
                        />
                        <span>{other.name}</span>
                      </label>
                    ))}
                  {entries.length <= 1 && (
                    <span className="faint" style={{ fontSize: 11.5 }}>
                      Create other configurations first, then tick them here.
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <>
                <label className="field">
                  <span>Command</span>
                  <input
                    className="mono"
                    value={entry.command ?? ''}
                    placeholder="npm run dev"
                    onChange={(e) => update({ command: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Arguments</span>
                  <input
                    className="mono"
                    value={entry.args ?? ''}
                    placeholder="--port 3001 --verbose"
                    onChange={(e) => update({ args: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Working directory (relative to the project)</span>
                  <input
                    className="mono"
                    value={entry.cwd ?? ''}
                    placeholder="packages/web"
                    onChange={(e) => update({ cwd: e.target.value || undefined })}
                  />
                </label>
                <EnvEditor env={entry.env ?? {}} onChange={(env) => update({ env })} />
                <label className="field">
                  <span>Before launch — one command per line, each must succeed</span>
                  <textarea
                    className="mono"
                    rows={3}
                    style={{ resize: 'vertical', fontSize: 12 }}
                    value={(entry.before ?? []).join('\n')}
                    placeholder={'npm run build\nnpm run migrate'}
                    onChange={(e) =>
                      update({ before: e.target.value.split('\n').map((l) => l.trim()).filter(Boolean) })
                    }
                  />
                </label>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function EnvEditor({ env, onChange }: { env: Record<string, string>; onChange: (env: Record<string, string>) => void }) {
  const rows = Object.entries(env)
  return (
    <div className="field">
      <span>Environment variables</span>
      <div style={{ display: 'grid', gap: 4 }}>
        {rows.map(([key, value], index) => (
          <div key={index} className="row" style={{ gap: 6 }}>
            <input
              className="mono"
              style={{ width: 180 }}
              value={key}
              placeholder="NAME"
              onChange={(e) => {
                const next = rows.map(([k, v], i) => (i === index ? [e.target.value, v] : [k, v]))
                onChange(Object.fromEntries(next))
              }}
            />
            <input
              className="mono"
              style={{ flex: 1 }}
              value={value}
              placeholder="value"
              onChange={(e) => {
                const next = rows.map(([k, v], i) => (i === index ? [k, e.target.value] : [k, v]))
                onChange(Object.fromEntries(next))
              }}
            />
            <button
              className="icon-btn"
              style={{ width: 22, height: 22 }}
              title="Remove this variable"
              onClick={() => onChange(Object.fromEntries(rows.filter((_r, i) => i !== index)))}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button
          className="btn sm"
          style={{ justifySelf: 'start' }}
          onClick={() => onChange({ ...env, '': '' })}
        >
          <Plus size={12} /> Add variable
        </button>
      </div>
    </div>
  )
}
