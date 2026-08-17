/**
 * The database console: connections and schema on the left, SQL and results on
 * the right.
 *
 * The query editor is a plain textarea rather than a Monaco instance — a
 * console is somewhere you paste a query, run it, and read the grid — but it
 * is schema-aware: ⌃Space (or just typing) offers tables after FROM and
 * columns elsewhere, fed by the same introspection the sidebar shows. The
 * grid itself turns editable when the query is a single-table SELECT whose
 * primary key is in the result, which is the only case an UPDATE can be
 * generated for without guessing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Diff,
  FileCode2,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import { useStore } from '@/state/store'
import type {
  DatabaseConnection,
  DatabaseKind,
  DatabaseSchema,
  DriverStatus,
  QueryResult,
} from '@shared/database'
import {
  buildUpdates,
  diffSchemas,
  editableTarget,
  generateDdl,
  sqlCompletions,
  type CellEdit,
  type SqlSuggestion,
} from '@/lib/sqlTools'

export default function DatabaseView() {
  const [connections, setConnections] = useState<DatabaseConnection[]>([])
  const [drivers, setDrivers] = useState<DriverStatus[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [schema, setSchema] = useState<DatabaseSchema | null>(null)
  const [schemaBusy, setSchemaBusy] = useState(false)
  const [sql, setSql] = useState('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [running, setRunning] = useState(false)
  const [adding, setAdding] = useState(false)
  /** The SQL the current result came from, for editable-grid analysis. */
  const [resultSql, setResultSql] = useState('')
  const [suggestions, setSuggestions] = useState<SqlSuggestion[]>([])
  const [suggestionIndex, setSuggestionIndex] = useState(0)
  const sqlRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void (async () => {
      const [list, driverList] = await Promise.all([
        window.nova.db.connections(),
        window.nova.db.drivers(),
      ])
      setConnections(list)
      setDrivers(driverList)
      setActiveId((current) => current ?? list[0]?.id ?? null)
    })()
  }, [])

  const loadSchema = useCallback(async (id: string) => {
    setSchemaBusy(true)
    try {
      setSchema(await window.nova.db.schema(id))
    } finally {
      setSchemaBusy(false)
    }
  }, [])

  useEffect(() => {
    if (activeId) void loadSchema(activeId)
    else setSchema(null)
  }, [activeId, loadSchema])

  const run = useCallback(async () => {
    if (!activeId || !sql.trim()) return
    setRunning(true)
    setSuggestions([])
    try {
      setResult(await window.nova.db.query(activeId, sql))
      setResultSql(sql)
    } finally {
      setRunning(false)
    }
  }, [activeId, sql])

  const active = connections.find((c) => c.id === activeId)
  const driver = drivers.find((d) => d.kind === active?.kind)

  /** Recomputes the completion popup for the text before the caret. */
  const refreshSuggestions = useCallback(
    (value: string, caret: number) => {
      if (!schema || schema.tables.length === 0) {
        setSuggestions([])
        return
      }
      const prefix = value.slice(0, caret)
      const token = /[\w."]*$/.exec(prefix)?.[0] ?? ''
      if (token.length === 0 && !/[.\s]$/.test(prefix)) {
        setSuggestions([])
        return
      }
      setSuggestions(token.length > 0 || prefix.endsWith('.') ? sqlCompletions(prefix, schema) : [])
      setSuggestionIndex(0)
    },
    [schema],
  )

  const acceptSuggestion = useCallback(
    (suggestion: SqlSuggestion) => {
      const textarea = sqlRef.current
      if (!textarea) return
      const caret = textarea.selectionStart
      const before = sql.slice(0, caret)
      const token = /[\w."]*$/.exec(before)?.[0] ?? ''
      // Keep a `table.` qualifier the user already typed.
      const keep = token.includes('.') ? token.slice(0, token.lastIndexOf('.') + 1) : ''
      const next = `${before.slice(0, before.length - token.length)}${keep}${suggestion.insert}${sql.slice(caret)}`
      setSql(next)
      setSuggestions([])
      const position = before.length - token.length + keep.length + suggestion.insert.length
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(position, position)
      })
    },
    [sql],
  )

  /** Opens generated text in a scratch file, where it can be edited and saved. */
  const openAsScratch = useCallback(async (name: string, content: string) => {
    const home = await window.nova.app.homeDir()
    const path = `${home}/.nova/scratches/${name}`
    await window.nova.fs.write(path, content)
    await useStore.getState().openFile(path)
  }, [])

  return (
    <div className="db-view">
      <div className="db-sidebar">
        <div className="db-sidebar-head">
          <span>Connections</span>
          <button className="icon-btn" title="Add a connection" onClick={() => setAdding(true)}>
            <Plus size={13} />
          </button>
        </div>

        {!connections.length && !adding && (
          <p className="faint" style={{ padding: 10, fontSize: 11, lineHeight: 1.6 }}>
            No connections yet. Nova uses the database client already installed on your machine.
          </p>
        )}

        {connections.map((connection) => (
          <button
            key={connection.id}
            className={`db-conn ${activeId === connection.id ? 'active' : ''}`}
            onClick={() => setActiveId(connection.id)}
          >
            <Database size={12} />
            <span className="db-conn-name">{connection.name}</span>
            <span className="db-conn-kind">{connection.kind}</span>
            {connection.hasStoredPassword && <KeyRound size={9} className="faint" />}
          </button>
        ))}

        {adding && (
          <ConnectionForm
            drivers={drivers}
            onCancel={() => setAdding(false)}
            onSaved={(list, id) => {
              setConnections(list)
              setActiveId(id)
              setAdding(false)
            }}
          />
        )}

        {active && (
          <div className="db-actions">
            <button
              className="btn sm"
              onClick={async () => {
                const outcome = await window.nova.db.test(active.id)
                useStore.getState().notify(outcome.message, outcome.ok ? 'success' : 'error')
              }}
            >
              Test
            </button>
            <button className="btn sm" onClick={() => void loadSchema(active.id)}>
              <RefreshCw size={11} />
            </button>
            <button
              className="btn sm danger"
              onClick={async () => {
                if (!confirm(`Remove the connection “${active.name}”?`)) return
                const list = await window.nova.db.remove(active.id)
                setConnections(list)
                setActiveId(list[0]?.id ?? null)
              }}
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}

        {driver && !driver.available && (
          <div className="db-driver-warning">
            <AlertTriangle size={12} />
            <span>
              <code className="mono">{driver.binary}</code> is not installed. {driver.hint}
            </span>
          </div>
        )}

        <div className="db-schema">
          {schemaBusy && <Loader2 size={13} className="spin faint" style={{ margin: 10 }} />}
          {schema?.error && <div className="db-schema-error">{schema.error}</div>}
          {schema?.tables.map((table) => (
            <TableNode
              key={`${table.schema}.${table.name}`}
              table={table}
              onSelect={() =>
                setSql(`SELECT *\nFROM ${qualify(table.schema, table.name)}\nLIMIT 100;`)
              }
            />
          ))}
        </div>
      </div>

      <div className="db-main">
        <div className="db-toolbar">
          <button className="btn primary sm" disabled={!activeId || running} onClick={() => void run()}>
            {running ? <Loader2 size={12} className="spin" /> : <Play size={12} />} Run
          </button>
          <span className="faint" style={{ fontSize: 10.5 }}>
            ⌘⏎ to run · Tab accepts a completion
          </span>
          {active && schema && schema.tables.length > 0 && (
            <>
              <button
                className="btn ghost sm"
                title="Generate CREATE TABLE statements from the live schema"
                onClick={() =>
                  void openAsScratch(`ddl_${active.name.replace(/\W+/g, '_')}.sql`, generateDdl(schema, active.kind))
                }
              >
                <FileCode2 size={12} /> DDL
              </button>
              {connections.length > 1 && (
                <select
                  className="select"
                  style={{ width: 150, fontSize: 11 }}
                  value=""
                  title="Diff this schema against another connection's"
                  onChange={async (e) => {
                    const other = connections.find((c) => c.id === e.target.value)
                    if (!other) return
                    useStore.getState().notify(`Introspecting ${other.name}…`, 'info')
                    const otherSchema = await window.nova.db.schema(other.id)
                    if (otherSchema.error) {
                      useStore.getState().notify(otherSchema.error, 'error')
                      return
                    }
                    await openAsScratch(
                      `schema_diff_${active.name}_${other.name}.md`.replace(/\W+/g, '_') + '.md',
                      diffSchemas(schema, otherSchema, active.kind),
                    )
                  }}
                >
                  <option value="">Diff schema against…</option>
                  {connections
                    .filter((c) => c.id !== active.id)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              )}
            </>
          )}
          {result && !result.error && (
            <span className="faint" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
              {result.rowCount} row{result.rowCount === 1 ? '' : 's'} · {result.durationMs} ms
              {result.truncated && ' · truncated'}
            </span>
          )}
        </div>

        <div style={{ position: 'relative' }}>
          <textarea
            ref={sqlRef}
            className="db-sql mono"
            placeholder="SELECT * FROM …"
            value={sql}
            spellCheck={false}
            onChange={(e) => {
              setSql(e.target.value)
              refreshSuggestions(e.target.value, e.target.selectionStart)
            }}
            onBlur={() => setTimeout(() => setSuggestions([]), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void run()
                return
              }
              if (suggestions.length > 0) {
                if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                  if (e.key === 'Enter' && suggestions.length === 0) return
                  e.preventDefault()
                  acceptSuggestion(suggestions[suggestionIndex])
                  return
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setSuggestionIndex((i) => Math.min(i + 1, suggestions.length - 1))
                  return
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setSuggestionIndex((i) => Math.max(i - 1, 0))
                  return
                }
                if (e.key === 'Escape') {
                  setSuggestions([])
                  return
                }
              }
              if (e.key === ' ' && e.ctrlKey) {
                e.preventDefault()
                refreshSuggestions(sql, (e.target as HTMLTextAreaElement).selectionStart)
              }
            }}
          />
          {suggestions.length > 0 && (
            <div className="db-suggest">
              {suggestions.slice(0, 12).map((suggestion, index) => (
                <button
                  key={`${suggestion.kind}:${suggestion.label}`}
                  className={`db-suggest-item ${index === suggestionIndex ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    acceptSuggestion(suggestion)
                  }}
                  onMouseEnter={() => setSuggestionIndex(index)}
                >
                  <span className={`db-suggest-kind kind-${suggestion.kind}`}>
                    {suggestion.kind === 'table' ? 'T' : suggestion.kind === 'column' ? 'c' : 'k'}
                  </span>
                  <span className="mono" style={{ fontSize: 11.5 }}>{suggestion.label}</span>
                  {suggestion.detail && (
                    <span className="faint" style={{ fontSize: 10, marginLeft: 'auto' }}>
                      {suggestion.detail}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="db-result">
          {result?.error && (
            <pre className="db-error">{result.error}</pre>
          )}
          {result?.message && !result.error && <div className="db-message">{result.message}</div>}
          {result && !result.error && result.columns.length > 0 && (
            <ResultGrid
              result={result}
              sql={resultSql}
              schema={schema}
              onApply={async (statements) => {
                if (!activeId) return false
                const outcome = await window.nova.db.query(activeId, statements.join('\n'))
                if (outcome.error) {
                  useStore.getState().notify(outcome.error, 'error')
                  return false
                }
                useStore
                  .getState()
                  .notify(`${statements.length} row${statements.length === 1 ? '' : 's'} updated`, 'success')
                void run()
                return true
              }}
            />
          )}
          {!result && (
            <div className="empty-state">
              <span className="faint">Run a query to see results.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The result grid, editable when the query allows it.
 *
 * Edits are staged rather than written per keystroke: a pending set is shown
 * as a count with the generated SQL one click away, so nothing reaches the
 * database until the user has seen the exact statements.
 */
function ResultGrid({
  result,
  sql,
  schema,
  onApply,
}: {
  result: QueryResult
  sql: string
  schema: DatabaseSchema | null
  onApply: (statements: string[]) => Promise<boolean>
}) {
  const [edits, setEdits] = useState<CellEdit[]>([])
  const [editing, setEditing] = useState<{ row: number; column: number } | null>(null)
  const [applying, setApplying] = useState(false)

  const target = useMemo(
    () => (schema ? editableTarget(sql, result.columns, schema) : null),
    [sql, result.columns, schema],
  )

  useEffect(() => {
    setEdits([])
    setEditing(null)
  }, [result])

  const valueAt = (row: number, column: number) =>
    edits.find((edit) => edit.row === row && edit.column === column)?.value ?? result.rows[row]?.[column] ?? ''

  const stage = (row: number, column: number, value: string) => {
    setEditing(null)
    const original = result.rows[row]?.[column] ?? ''
    setEdits((current) => {
      const without = current.filter((edit) => !(edit.row === row && edit.column === column))
      return value === original ? without : [...without, { row, column, value }]
    })
  }

  const statements = target ? buildUpdates(target, result.columns, result.rows, edits) : []

  return (
    <div className="db-grid-wrap">
      {target && (
        <div className="db-grid-bar">
          <span className="faint" style={{ fontSize: 10.5 }}>
            Editable — double-click a cell. Rows are addressed by {target.pkColumns.join(', ')}.
          </span>
          {edits.length > 0 && (
            <>
              <span className="chip" style={{ marginLeft: 'auto' }}>{statements.length} pending</span>
              <button
                className="btn sm"
                title={statements.join('\n')}
                onClick={() => void navigator.clipboard.writeText(statements.join('\n'))}
              >
                Copy SQL
              </button>
              <button className="btn sm" onClick={() => setEdits([])}>
                <X size={11} /> Discard
              </button>
              <button
                className="btn primary sm"
                disabled={applying}
                onClick={async () => {
                  setApplying(true)
                  try {
                    if (await onApply(statements)) setEdits([])
                  } finally {
                    setApplying(false)
                  }
                }}
              >
                <Check size={11} /> Apply
              </button>
            </>
          )}
        </div>
      )}
      {!target && schema && (
        <div className="db-grid-bar">
          <span className="faint" style={{ fontSize: 10.5 }}>
            Read-only — editing needs a single-table SELECT whose primary key is in the result.
          </span>
        </div>
      )}
      <table className="db-grid mono">
        <thead>
          <tr>
            <th className="db-rownum" />
            {result.columns.map((column, i) => (
              <th key={`${column}:${i}`}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, r) => (
            <tr key={r}>
              <td className="db-rownum">{r + 1}</td>
              {result.columns.map((_, c) => {
                const changed = edits.some((edit) => edit.row === r && edit.column === c)
                const value = valueAt(r, c)
                const isEditing = editing?.row === r && editing.column === c
                return (
                  <td
                    key={c}
                    className={`${value === '' ? 'db-null' : ''} ${changed ? 'db-edited' : ''}`}
                    onDoubleClick={() => target && setEditing({ row: r, column: c })}
                    title={target ? 'Double-click to edit' : undefined}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        className="mono db-cell-input"
                        defaultValue={value}
                        onBlur={(e) => stage(r, c, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') stage(r, c, (e.target as HTMLInputElement).value)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                      />
                    ) : value === '' || value === undefined ? (
                      'NULL'
                    ) : (
                      value
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TableNode({ table, onSelect }: { table: DatabaseSchema['tables'][number]; onSelect: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button className="db-table" onClick={() => setOpen((v) => !v)} onDoubleClick={onSelect}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <Table2 size={11} className={table.kind === 'view' ? 'faint' : ''} />
        <span className="db-table-name">{table.name}</span>
        <span className="faint" style={{ fontSize: 9 }}>
          {table.columns.length}
        </span>
      </button>
      {open &&
        table.columns.map((column) => (
          <div key={column.name} className="db-column">
            {column.primaryKey && <KeyRound size={9} className="db-pk" />}
            <span className="db-column-name">{column.name}</span>
            <span className="db-column-type">{column.type}</span>
            {!column.nullable && <span className="db-notnull">NOT NULL</span>}
          </div>
        ))}
    </div>
  )
}

function ConnectionForm({
  drivers,
  onCancel,
  onSaved,
}: {
  drivers: DriverStatus[]
  onCancel: () => void
  onSaved: (list: DatabaseConnection[], id: string) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<DatabaseKind>('postgres')
  const [url, setUrl] = useState('')
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)

  const placeholder = useMemo(() => {
    if (kind === 'sqlite') return '/path/to/database.sqlite'
    if (kind === 'mysql') return 'mysql://user@localhost:3306/dbname'
    return 'postgres://user@localhost:5432/dbname'
  }, [kind])

  return (
    <div className="db-form">
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <select value={kind} onChange={(e) => setKind(e.target.value as DatabaseKind)}>
        {drivers.map((driver) => (
          <option key={driver.kind} value={driver.kind}>
            {driver.kind}
            {driver.available ? '' : ' (client not installed)'}
          </option>
        ))}
      </select>
      <input placeholder={placeholder} value={url} spellCheck={false} onChange={(e) => setUrl(e.target.value)} />
      {kind !== 'sqlite' && (
        <>
          <input
            type="password"
            placeholder="Password (optional)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="faint" style={{ fontSize: 9.5, lineHeight: 1.5 }}>
            Stored in the OS keychain. Leave blank to use <code className="mono">~/.pgpass</code>,
            <code className="mono"> ~/.my.cnf</code> or an existing socket auth.
          </span>
        </>
      )}
      <div className="row" style={{ gap: 4 }}>
        <button
          className="btn primary sm"
          disabled={!name.trim() || !url.trim() || saving}
          onClick={async () => {
            setSaving(true)
            try {
              const connection: DatabaseConnection = {
                id: `db_${Date.now().toString(36)}`,
                name: name.trim(),
                kind,
                url: url.trim(),
                createdAt: Date.now(),
              }
              const list = await window.nova.db.save(connection, password || null)
              onSaved(list, connection.id)
            } finally {
              setSaving(false)
            }
          }}
        >
          Save
        </button>
        <button className="btn sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Qualifies a table name only when it actually lives in a named schema. */
function qualify(schema: string, name: string): string {
  return schema && schema !== 'public' ? `${schema}.${name}` : name
}
