/**
 * SQL tooling over the introspected schema: completion, DDL generation, schema
 * diff, and the analysis that makes a result grid safely editable.
 *
 * All pure — the console feeds it the `DatabaseSchema` it already loads for
 * the sidebar, so being schema-aware costs no extra round-trips.
 */

import type { ColumnInfo, DatabaseKind, DatabaseSchema, TableInfo } from '@shared/database'

/* ================================================================== */
/* Completion                                                          */
/* ================================================================== */

export interface SqlSuggestion {
  label: string
  kind: 'table' | 'column' | 'keyword'
  detail: string
  /** What accepting inserts (differs from label when qualifying). */
  insert: string
}

const KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN', 'INNER JOIN', 'GROUP BY', 'ORDER BY',
  'HAVING', 'LIMIT', 'OFFSET', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
  'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'DISTINCT', 'COUNT(*)', 'AS', 'ON', 'AND',
  'OR', 'NOT', 'NULL', 'IS NULL', 'IS NOT NULL', 'IN', 'LIKE', 'BETWEEN', 'UNION',
]

export function qualifyTable(table: TableInfo): string {
  return table.schema && table.schema !== 'public' && table.schema !== 'main'
    ? `${table.schema}.${table.name}`
    : table.name
}

/** Table names appearing in FROM/JOIN/UPDATE/INTO clauses of the statement. */
export function tablesInStatement(sql: string, schema: DatabaseSchema): TableInfo[] {
  const found: TableInfo[] = []
  for (const match of sql.matchAll(/\b(?:from|join|update|into)\s+([\w."]+)/gi)) {
    const raw = match[1].replace(/"/g, '')
    const name = raw.split('.').pop() ?? raw
    const table = schema.tables.find((t) => t.name.toLowerCase() === name.toLowerCase())
    if (table && !found.includes(table)) found.push(table)
  }
  return found
}

/**
 * Suggestions for the token being typed at the end of `prefix`.
 *
 * Context comes from the last keyword: after FROM/JOIN it is tables, after
 * `alias.` or inside SELECT/WHERE it is columns — of the statement's own
 * tables first, since those are almost always what is meant.
 */
export function sqlCompletions(prefix: string, schema: DatabaseSchema): SqlSuggestion[] {
  const token = /[\w."]*$/.exec(prefix)?.[0] ?? ''
  const needle = token.toLowerCase().replace(/"/g, '')
  const before = prefix.slice(0, prefix.length - token.length)

  // `table.` or `alias.` — members of that table only.
  const dotted = /([\w"]+)\.$/.exec(before) ?? (token.includes('.') ? /^([\w"]+)\./.exec(token) : null)
  if (dotted) {
    const owner = dotted[1].replace(/"/g, '').toLowerCase()
    const table = schema.tables.find((t) => t.name.toLowerCase() === owner)
    const columnNeedle = token.includes('.') ? token.split('.').pop()!.toLowerCase() : needle
    if (table) {
      return table.columns
        .filter((column) => !columnNeedle || column.name.toLowerCase().startsWith(columnNeedle))
        .map((column) => ({
          label: column.name,
          kind: 'column' as const,
          detail: `${column.type}${column.primaryKey ? ' · PK' : ''} — ${table.name}`,
          insert: column.name,
        }))
    }
  }

  // The *last* clause keyword decides what is legal here. Scanning for all of
  // them and taking the last is the only way to get `FROM orders WHERE …`
  // right: a pattern anchored on `from` would still match across the `where`.
  const keywords = [...before.matchAll(/\b(from|join|update|into|select|where|by|set|on|and|or|having)\b/gi)]
  const lastKeyword = keywords[keywords.length - 1]?.[1]?.toLowerCase()

  const out: SqlSuggestion[] = []

  if (lastKeyword === 'from' || lastKeyword === 'join' || lastKeyword === 'update' || lastKeyword === 'into') {
    for (const table of schema.tables) {
      if (needle && !table.name.toLowerCase().startsWith(needle)) continue
      out.push({
        label: table.name,
        kind: 'table',
        detail: `${table.kind} · ${table.columns.length} columns`,
        insert: qualifyTable(table),
      })
    }
    return out.slice(0, 30)
  }

  // Column position: statement tables first, then every table.
  const statementTables = tablesInStatement(before, schema)
  const pools = statementTables.length ? statementTables : schema.tables
  for (const table of pools) {
    for (const column of table.columns) {
      if (needle && !column.name.toLowerCase().startsWith(needle)) continue
      out.push({
        label: column.name,
        kind: 'column',
        detail: `${column.type} — ${table.name}`,
        insert: column.name,
      })
      if (out.length > 40) break
    }
  }
  for (const keyword of KEYWORDS) {
    if (needle && !keyword.toLowerCase().startsWith(needle)) continue
    out.push({ label: keyword, kind: 'keyword', detail: '', insert: keyword })
  }
  // Tables are legal in most positions too; offer them after the columns.
  if (needle) {
    for (const table of schema.tables) {
      if (!table.name.toLowerCase().startsWith(needle)) continue
      out.push({ label: table.name, kind: 'table', detail: table.kind, insert: qualifyTable(table) })
    }
  }
  return dedupe(out).slice(0, 30)
}

function dedupe(suggestions: SqlSuggestion[]): SqlSuggestion[] {
  const seen = new Set<string>()
  return suggestions.filter((s) => {
    const key = `${s.kind}:${s.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/* ================================================================== */
/* Editable grid                                                       */
/* ================================================================== */

export interface EditableTarget {
  table: TableInfo
  /** Column names of the primary key — all must be present in the result. */
  pkColumns: string[]
  /** Result-column index of each PK column. */
  pkIndexes: number[]
}

/**
 * Whether a result grid can be edited safely: the query reads from exactly one
 * known table and every primary-key column is present in the result, so each
 * row can be addressed by an UPDATE that cannot hit anything else.
 */
export function editableTarget(sql: string, columns: string[], schema: DatabaseSchema): EditableTarget | null {
  if (!/^\s*select\b/i.test(sql)) return null
  if (/\bjoin\b/i.test(sql)) return null
  const tables = tablesInStatement(sql, schema)
  if (tables.length !== 1) return null
  const table = tables[0]
  const pk = table.columns.filter((column) => column.primaryKey)
  if (pk.length === 0) return null
  const lower = columns.map((c) => c.toLowerCase())
  const pkIndexes = pk.map((column) => lower.indexOf(column.name.toLowerCase()))
  if (pkIndexes.some((index) => index === -1)) return null
  return { table, pkColumns: pk.map((c) => c.name), pkIndexes }
}

export interface CellEdit {
  /** Row index in the result set. */
  row: number
  /** Column index in the result set. */
  column: number
  value: string
}

function sqlLiteral(value: string, column: ColumnInfo | undefined): string {
  if (value === '' || value.toUpperCase() === 'NULL') return 'NULL'
  const type = (column?.type ?? '').toLowerCase()
  if (/int|numeric|decimal|real|double|float|serial|bool/.test(type) && /^[-\d.]+$|^(true|false)$/i.test(value)) {
    return value
  }
  return `'${value.replace(/'/g, "''")}'`
}

/** One UPDATE per edited row, addressed by the primary key's original values. */
export function buildUpdates(
  target: EditableTarget,
  columns: string[],
  rows: string[][],
  edits: CellEdit[],
): string[] {
  const byRow = new Map<number, CellEdit[]>()
  for (const edit of edits) byRow.set(edit.row, [...(byRow.get(edit.row) ?? []), edit])

  const statements: string[] = []
  for (const [rowIndex, rowEdits] of byRow) {
    const row = rows[rowIndex]
    if (!row) continue
    const sets = rowEdits
      .map((edit) => {
        const columnName = columns[edit.column]
        const info = target.table.columns.find((c) => c.name.toLowerCase() === columnName.toLowerCase())
        return `${columnName} = ${sqlLiteral(edit.value, info)}`
      })
      .join(', ')
    const where = target.pkColumns
      .map((pkName, i) => {
        const original = row[target.pkIndexes[i]]
        const info = target.table.columns.find((c) => c.name === pkName)
        return `${pkName} = ${sqlLiteral(original ?? '', info)}`
      })
      .join(' AND ')
    statements.push(`UPDATE ${qualifyTable(target.table)} SET ${sets} WHERE ${where};`)
  }
  return statements
}

/* ================================================================== */
/* DDL generation + schema diff                                        */
/* ================================================================== */

export function tableDdl(table: TableInfo, kind: DatabaseKind): string {
  const pk = table.columns.filter((column) => column.primaryKey).map((column) => column.name)
  const lines = table.columns.map((column) => {
    const parts = [`  ${column.name}`, column.type || 'text']
    if (!column.nullable) parts.push('NOT NULL')
    if (pk.length === 1 && column.primaryKey && kind !== 'mysql') parts.push('PRIMARY KEY')
    return parts.join(' ')
  })
  if (pk.length > 1 || (pk.length === 1 && kind === 'mysql')) {
    lines.push(`  PRIMARY KEY (${pk.join(', ')})`)
  }
  return `CREATE TABLE ${qualifyTable(table)} (\n${lines.join(',\n')}\n);`
}

export function generateDdl(schema: DatabaseSchema, kind: DatabaseKind): string {
  const tables = schema.tables.filter((table) => table.kind !== 'view')
  return [
    `-- Generated by Nova from the live schema (${tables.length} tables)`,
    '',
    ...tables.map((table) => tableDdl(table, kind)),
  ].join('\n\n')
}

/** Differences from `from` to `to`, as prose plus best-effort migration DDL. */
export function diffSchemas(from: DatabaseSchema, to: DatabaseSchema, kind: DatabaseKind): string {
  const fromTables = new Map(from.tables.map((table) => [qualifyTable(table), table]))
  const toTables = new Map(to.tables.map((table) => [qualifyTable(table), table]))

  const added = [...toTables.keys()].filter((name) => !fromTables.has(name))
  const removed = [...fromTables.keys()].filter((name) => !toTables.has(name))
  const changed: { name: string; notes: string[]; ddl: string[] }[] = []

  for (const [name, target] of toTables) {
    const source = fromTables.get(name)
    if (!source) continue
    const notes: string[] = []
    const ddl: string[] = []
    const sourceColumns = new Map(source.columns.map((column) => [column.name.toLowerCase(), column]))
    const targetColumns = new Map(target.columns.map((column) => [column.name.toLowerCase(), column]))

    for (const [columnName, column] of targetColumns) {
      const existing = sourceColumns.get(columnName)
      if (!existing) {
        notes.push(`+ column \`${column.name}\` ${column.type}`)
        ddl.push(
          `ALTER TABLE ${name} ADD COLUMN ${column.name} ${column.type || 'text'}${column.nullable ? '' : ' NOT NULL'};`,
        )
        continue
      }
      if ((existing.type || '') !== (column.type || '')) {
        notes.push(`~ column \`${column.name}\`: ${existing.type || '?'} → ${column.type || '?'}`)
        ddl.push(
          kind === 'mysql'
            ? `ALTER TABLE ${name} MODIFY ${column.name} ${column.type};`
            : `ALTER TABLE ${name} ALTER COLUMN ${column.name} TYPE ${column.type};`,
        )
      }
      if (existing.nullable !== column.nullable) {
        notes.push(`~ column \`${column.name}\`: ${column.nullable ? 'NULL' : 'NOT NULL'}`)
      }
    }
    for (const [columnName, column] of sourceColumns) {
      if (!targetColumns.has(columnName)) {
        notes.push(`- column \`${column.name}\``)
        ddl.push(`ALTER TABLE ${name} DROP COLUMN ${column.name};`)
      }
    }
    if (notes.length) changed.push({ name, notes, ddl })
  }

  if (!added.length && !removed.length && !changed.length) {
    return '# Schema diff\n\nThe schemas are identical.'
  }

  const sections: string[] = ['# Schema diff', '']
  if (added.length) {
    sections.push('## Tables only in the target', '')
    for (const name of added) {
      sections.push(`- \`${name}\``)
    }
    sections.push('', '```sql', ...added.map((name) => tableDdl(toTables.get(name)!, kind)), '```', '')
  }
  if (removed.length) {
    sections.push('## Tables only in the source', '')
    for (const name of removed) sections.push(`- \`${name}\` (would need \`DROP TABLE ${name};\`)`)
    sections.push('')
  }
  if (changed.length) {
    sections.push('## Changed tables', '')
    for (const entry of changed) {
      sections.push(`### ${entry.name}`, '', ...entry.notes.map((note) => `- ${note}`), '')
      if (entry.ddl.length) sections.push('```sql', ...entry.ddl, '```', '')
    }
  }
  return sections.join('\n')
}
