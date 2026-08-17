/**
 * Database connections, schemas and query results.
 *
 * Nova drives the database through the command-line client the user already
 * has installed — `psql`, `mysql`, `sqlite3` — rather than bundling drivers.
 * That means no native modules to build per platform, it honours the auth the
 * user has already configured (`~/.pgpass`, `~/.my.cnf`, sockets, TLS), and the
 * connection Nova opens is the same one their terminal opens. The cost is that
 * a driver must be on PATH, which the UI reports plainly.
 */

export type DatabaseKind = 'postgres' | 'mysql' | 'sqlite'

export interface DatabaseConnection {
  id: string
  name: string
  kind: DatabaseKind
  /**
   * A connection URL (`postgres://user@host:5432/db`) or, for SQLite, a file
   * path. Credentials embedded here are stored as typed — the UI says so.
   */
  url: string
  /** Set when the user asked Nova to remember a password separately. */
  hasStoredPassword?: boolean
  createdAt: number
}

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  primaryKey: boolean
}

export interface TableInfo {
  schema: string
  name: string
  /** 'table' | 'view' */
  kind: string
  columns: ColumnInfo[]
}

export interface DatabaseSchema {
  connectionId: string
  tables: TableInfo[]
  error?: string
}

export interface QueryResult {
  /** Column names, in order. */
  columns: string[]
  /** Row values as strings; the CLIs give us text and typing it back is guesswork. */
  rows: string[][]
  rowCount: number
  durationMs: number
  /** Set for statements that return no rows, e.g. INSERT. */
  message?: string
  error?: string
  /** True when the result was cut off at the row limit. */
  truncated?: boolean
}

export interface DriverStatus {
  kind: DatabaseKind
  binary: string
  available: boolean
  version: string
  hint: string
}
