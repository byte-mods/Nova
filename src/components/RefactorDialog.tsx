import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Plus, Trash2, X } from 'lucide-react'
import { useStore } from '@/state/store'
import { resolveRefactorDialog, type DialogField } from '@/lib/refactor/bridge'

interface ParamRow {
  name: string
  type?: string
  initializer?: string
  originalIndex: number
  callSiteValue?: string
}

interface MemberRow {
  id: string
  label: string
  checked: boolean
}

/**
 * The parameter step every refactoring goes through before its preview.
 *
 * Fields are declared by the bridge rather than hard-coded per refactoring, so
 * adding one is a data change. Two field kinds carry their own editor: the
 * parameter table used by Change Signature, and the checkbox list used by
 * Pull Up / Push Down and Introduce Parameter Object.
 */
export default function RefactorDialog() {
  const dialog = useStore((s) => s.refactorDialog)
  const [values, setValues] = useState<Record<string, unknown>>({})

  useEffect(() => {
    if (!dialog) return
    setValues(Object.fromEntries(dialog.fields.map((field) => [field.key, field.value])))
  }, [dialog])

  const firstTextKey = useMemo(
    () => dialog?.fields.find((f) => f.kind === 'text')?.key,
    [dialog],
  )

  if (!dialog) return null

  const set = (key: string, value: unknown) => setValues((current) => ({ ...current, [key]: value }))
  const submit = () => resolveRefactorDialog(values)
  const cancel = () => resolveRefactorDialog(null)

  return (
    <div className="overlay" style={{ paddingTop: 80 }} onMouseDown={cancel}>
      <div
        className="modal refactor-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
        }}
      >
        <div className="refactor-head">
          <b>{dialog.title}</b>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={cancel}>
            <X size={12} /> Cancel
          </button>
          <button className="btn primary sm" onClick={submit}>
            <Check size={12} /> {dialog.confirmLabel}
          </button>
        </div>

        {dialog.notes.length > 0 && (
          <div className="refactor-notes">
            {dialog.notes.map((note, index) => (
              <div key={index} className="refactor-note">
                {note}
              </div>
            ))}
          </div>
        )}

        <div className="refactor-fields">
          {dialog.fields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={values[field.key]}
              autoFocus={field.key === firstTextKey}
              onChange={(value) => set(field.key, value)}
              onSubmit={submit}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function Field({
  field,
  value,
  autoFocus,
  onChange,
  onSubmit,
}: {
  field: DialogField
  value: unknown
  autoFocus: boolean
  onChange: (value: unknown) => void
  onSubmit: () => void
}) {
  if (field.kind === 'checkbox') {
    return (
      <label className="refactor-check">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        <span>{field.label}</span>
      </label>
    )
  }

  if (field.kind === 'select') {
    return (
      <label className="field">
        <span>{field.label}</span>
        <select className="select" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (field.kind === 'members') {
    const rows = (value as MemberRow[]) ?? []
    return (
      <div className="field">
        <span>{field.label}</span>
        <div className="refactor-members">
          {rows.map((row, index) => (
            <label key={row.id} className="refactor-check">
              <input
                type="checkbox"
                checked={row.checked}
                onChange={(e) => {
                  const next = rows.map((r, i) => (i === index ? { ...r, checked: e.target.checked } : r))
                  onChange(next)
                }}
              />
              <span>{row.label}</span>
            </label>
          ))}
        </div>
      </div>
    )
  }

  if (field.kind === 'params') {
    return <ParamsEditor rows={(value as ParamRow[]) ?? []} onChange={onChange} />
  }

  return (
    <label className="field">
      <span>{field.label}</span>
      <input
        autoFocus={autoFocus}
        readOnly={field.readOnly}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit()
        }}
      />
      {field.hint && <span className="faint refactor-hint">{field.hint}</span>}
    </label>
  )
}

/** The Change Signature table: rename, retype, reorder, add and remove. */
function ParamsEditor({ rows, onChange }: { rows: ParamRow[]; onChange: (rows: ParamRow[]) => void }) {
  const update = (index: number, patch: Partial<ParamRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const swap = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return
    const next = [...rows]
    ;[next[from], next[to]] = [next[to], next[from]]
    onChange(next)
  }

  return (
    <div className="field">
      <span>Parameters</span>
      <div className="param-table">
        <div className="param-row param-head">
          <span>Name</span>
          <span>Type</span>
          <span>Default</span>
          <span>Call-site value</span>
          <span />
        </div>
        {rows.map((row, index) => (
          <div className="param-row" key={`${row.originalIndex}-${index}`}>
            <input value={row.name} onChange={(e) => update(index, { name: e.target.value })} />
            <input
              value={row.type ?? ''}
              onChange={(e) => update(index, { type: e.target.value })}
            />
            <input
              value={row.initializer ?? ''}
              onChange={(e) => update(index, { initializer: e.target.value })}
            />
            <input
              placeholder={row.originalIndex >= 0 ? '—' : 'required'}
              disabled={row.originalIndex >= 0}
              value={row.callSiteValue ?? ''}
              onChange={(e) => update(index, { callSiteValue: e.target.value })}
            />
            <span className="param-actions">
              <button className="icon-btn" title="Move up" onClick={() => swap(index, index - 1)}>
                <ArrowUp size={12} />
              </button>
              <button className="icon-btn" title="Move down" onClick={() => swap(index, index + 1)}>
                <ArrowDown size={12} />
              </button>
              <button
                className="icon-btn"
                title="Remove"
                onClick={() => onChange(rows.filter((_r, i) => i !== index))}
              >
                <Trash2 size={12} />
              </button>
            </span>
          </div>
        ))}
      </div>
      <button
        className="btn sm"
        style={{ alignSelf: 'flex-start', marginTop: 6 }}
        onClick={() =>
          onChange([...rows, { name: '', type: '', initializer: '', originalIndex: -1, callSiteValue: '' }])
        }
      >
        <Plus size={12} /> Add parameter
      </button>
    </div>
  )
}
