/**
 * Database tooling: connections, schema introspection and the query console.
 *
 * Everything goes through the user's own CLI client. That decision is explained
 * in `shared/database.ts`; the consequence here is that each driver needs its
 * own argument shape and its own way of producing machine-readable output.
 *
 * Statements are passed on **stdin**, never interpolated into a shell command.
 * A query is arbitrary user text and building a command string out of it would
 * make every quote in a WHERE clause a potential injection into their shell.
 */
import { app, ipcMain, safeStorage } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  DatabaseConnection,
  DatabaseKind,
  DatabaseSchema,
  DriverStatus,
  QueryResult,
  TableInfo,
} from '../../shared/database'
import { toolEnv, which } from '../lib/env'
import { execTool, toolInvocation } from '../lib/spawnTool'
import {
  readJsonFileOrQuarantine,
  StoreReadError,
  withFileLock,
  writeFileAtomic,
  writeJsonFile,
} from '../lib/fileStore'

const exec = promisify(execFile)

/** A runaway query should not hold the app open indefinitely. */
const QUERY_TIMEOUT_MS = 60_000
/** Rows beyond this are dropped; the grid says so. */
const ROW_LIMIT = 5000

const DRIVERS: Record<DatabaseKind, { binary: string; hint: string }> = {
  postgres: { binary: 'psql', hint: 'Install the PostgreSQL client tools (`brew install libpq`).' },
  mysql: { binary: 'mysql', hint: 'Install the MySQL client (`brew install mysql-client`).' },
  sqlite: { binary: 'sqlite3', hint: 'Install SQLite (`brew install sqlite`).' },
}

function connectionsFile() {
  return path.join(app.getPath('userData'), 'databases.json')
}

function secretsFile() {
  return path.join(app.getPath('userData'), 'database-secrets.bin')
}

async function readConnections(): Promise<DatabaseConnection[]> {
  const raw = await readJsonFileOrQuarantine<unknown>(connectionsFile(), [])
  return Array.isArray(raw) ? (raw as DatabaseConnection[]) : []
}

async function writeConnections(list: DatabaseConnection[]): Promise<void> {
  await writeJsonFile(connectionsFile(), list)
}

/**
 * Passwords go through Electron's `safeStorage`, which is backed by the OS
 * keychain. When encryption is unavailable the password is simply not stored —
 * writing it in plaintext would be worse than making the user retype it.
 */
/**
 * Every stored password, or a thrown error.
 *
 * No file yet is genuinely "no passwords". A file that will not decrypt is not
 * — the passwords are there and unreadable for now — and answering `{}` to both
 * meant one locked keychain plus one save wiped every other connection's
 * password along with it.
 */
async function readSecrets(): Promise<Record<string, string>> {
  if (!safeStorage.isEncryptionAvailable()) return {}
  let buffer: Buffer
  try {
    buffer = await fs.readFile(secretsFile())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new StoreReadError(secretsFile(), err)
  }
  try {
    return JSON.parse(safeStorage.decryptString(buffer))
  } catch (err) {
    throw new StoreReadError(secretsFile(), err)
  }
}

async function writeSecret(id: string, password: string | null): Promise<boolean> {
  if (!safeStorage.isEncryptionAvailable()) return false
  // Serialised so that saving two connections at once cannot have each read the
  // same secrets and write back a copy missing the other's password.
  return withFileLock(secretsFile(), async () => {
    // Not caught: a store that will not decrypt must stop the write rather than
    // be replaced by one that holds only the password being saved right now.
    const secrets = await readSecrets()
    if (password === null) delete secrets[id]
    else secrets[id] = password
    await writeFileAtomic(secretsFile(), safeStorage.encryptString(JSON.stringify(secrets)), {
      mode: 0o600,
    })
    return true
  })
}

export function registerDatabaseHandlers() {
  ipcMain.handle('db:drivers', async (): Promise<DriverStatus[]> => {
    const out: DriverStatus[] = []
    for (const [kind, driver] of Object.entries(DRIVERS) as [DatabaseKind, { binary: string; hint: string }][]) {
      const binary = await which(driver.binary)
      let version = ''
      if (binary) {
        try {
          const { stdout } = await execTool(binary, ['--version'], { timeout: 5000, env: toolEnv() })
          version = stdout.trim().split('\n')[0]
        } catch {
          version = ''
        }
      }
      out.push({ kind, binary: driver.binary, available: Boolean(binary), version, hint: driver.hint })
    }
    return out
  })

  ipcMain.handle('db:connections', () => readConnections())

  ipcMain.handle(
    'db:save',
    async (_e, connection: DatabaseConnection, password?: string | null): Promise<DatabaseConnection[]> => {
      // Validated at the boundary: `db:save` used to accept anything, and a
      // record with no `id` became an entry nothing could ever match or remove.
      if (!connection || typeof connection !== 'object' || typeof connection.id !== 'string' || !connection.id) {
        throw new Error('A database connection needs an id.')
      }
      if (typeof connection.kind !== 'string') {
        throw new Error('A database connection needs a kind.')
      }
      return withFileLock(connectionsFile(), async () => {
      const list = await readConnections()
      const index = list.findIndex((c) => c.id === connection.id)
      const record: DatabaseConnection = { ...connection }
      if (password !== undefined) {
        record.hasStoredPassword = password ? await writeSecret(connection.id, password) : false
        if (!password) await writeSecret(connection.id, null)
      }
      if (index === -1) list.push(record)
      else list[index] = record
      await writeConnections(list)
      return list
      })
    },
  )

  ipcMain.handle('db:remove', async (_e, id: string): Promise<DatabaseConnection[]> =>
    withFileLock(connectionsFile(), async () => {
      const list = (await readConnections()).filter((c) => c.id !== id)
      await writeSecret(id, null)
      await writeConnections(list)
      return list
    }),
  )

  ipcMain.handle('db:test', async (_e, id: string): Promise<{ ok: boolean; message: string }> => {
    const connection = (await readConnections()).find((c) => c.id === id)
    if (!connection) return { ok: false, message: 'No such connection.' }
    const result = await runQuery(connection, 'SELECT 1;')
    return result.error ? { ok: false, message: result.error } : { ok: true, message: 'Connected.' }
  })

  ipcMain.handle('db:schema', async (_e, id: string): Promise<DatabaseSchema> => {
    const connection = (await readConnections()).find((c) => c.id === id)
    if (!connection) return { connectionId: id, tables: [], error: 'No such connection.' }
    return introspect(connection)
  })

  ipcMain.handle('db:query', async (_e, id: string, sql: string): Promise<QueryResult> => {
    const connection = (await readConnections()).find((c) => c.id === id)
    if (!connection) {
      return { columns: [], rows: [], rowCount: 0, durationMs: 0, error: 'No such connection.' }
    }
    return runQuery(connection, sql)
  })
}

/**
 * Runs SQL and parses the client's output.
 *
 * Each driver is asked for a delimited, unaligned format so the result can be
 * split reliably rather than scraped out of an ASCII table.
 */
async function runQuery(connection: DatabaseConnection, sql: string): Promise<QueryResult> {
  const driver = DRIVERS[connection.kind]
  const binary = await which(driver.binary)
  const started = Date.now()

  if (!binary) {
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: 0,
      error: `\`${driver.binary}\` is not on PATH. ${driver.hint}`,
    }
  }

  const secrets = await readSecrets()
  const password = secrets[connection.id]

  let args: string[]
  const env = toolEnv()

  switch (connection.kind) {
    case 'postgres':
      // `-A` unaligned, `-F` field separator, `-R` record separator, `-q` quiet.
      args = ['-X', '-A', '-F', UNIT, '-R', RECORD, '--pset', 'footer=off', connection.url]
      if (password) env.PGPASSWORD = password
      break
    case 'mysql':
      // `--batch` gives tab-separated output with a header row.
      args = ['--batch', '--raw', ...mysqlArgs(connection.url)]
      if (password) env.MYSQL_PWD = password
      break
    case 'sqlite':
      args = ['-header', '-separator', UNIT, connection.url]
      break
  }

  try {
    const { stdout, stderr } = await execWithInput(binary, args, sql, {
      timeout: QUERY_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      env,
    })

    const parsed =
      connection.kind === 'mysql' ? parseDelimited(stdout, '\t', '\n') : parseDelimited(stdout, UNIT, connection.kind === 'postgres' ? RECORD : '\n')

    // A statement with no result set still succeeded; say so rather than
    // showing an empty grid that looks like a failure.
    if (!parsed.columns.length) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: Date.now() - started,
        message: stderr.trim() || stdout.trim() || 'Statement completed.',
      }
    }

    const truncated = parsed.rows.length > ROW_LIMIT
    return {
      columns: parsed.columns,
      rows: truncated ? parsed.rows.slice(0, ROW_LIMIT) : parsed.rows,
      rowCount: parsed.rows.length,
      durationMs: Date.now() - started,
      truncated,
    }
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message?: string; killed?: boolean }
    return {
      columns: [],
      rows: [],
      rowCount: 0,
      durationMs: Date.now() - started,
      error: e.killed
        ? `Query timed out after ${QUERY_TIMEOUT_MS / 1000}s.`
        : (e.stderr || e.message || 'Query failed.').trim(),
    }
  }
}

/**
 * Separators that will not occur in ordinary data.
 *
 * ASCII unit/record separators exist for exactly this and are far safer than a
 * comma or a pipe, either of which appears in real column values constantly.
 */
const UNIT = '\u001F'
const RECORD = '\u001E'

function parseDelimited(stdout: string, fieldSep: string, recordSep: string) {
  const text = stdout.replace(/\n$/, '')
  if (!text.trim()) return { columns: [], rows: [] as string[][] }

  const records = text.split(recordSep).filter((r) => r.length > 0)
  if (!records.length) return { columns: [], rows: [] as string[][] }

  const columns = records[0].split(fieldSep).map((c) => c.replace(/^\n+/, ''))
  const rows = records.slice(1).map((record) => record.replace(/^\n+/, '').split(fieldSep))
  return { columns, rows }
}

/** Turns a mysql:// URL into the flags the client expects. */
function mysqlArgs(url: string): string[] {
  try {
    const parsed = new URL(url)
    const args: string[] = []
    if (parsed.hostname) args.push('-h', parsed.hostname)
    if (parsed.port) args.push('-P', parsed.port)
    if (parsed.username) args.push('-u', decodeURIComponent(parsed.username))
    const database = parsed.pathname.replace(/^\//, '')
    if (database) args.push('-D', decodeURIComponent(database))
    return args
  } catch {
    return [url]
  }
}

/** `execFile` with the statement written to stdin rather than the argv. */
function execWithInput(
  binary: string,
  args: string[],
  input: string,
  options: { timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  // Resolved by hand rather than through `execTool`, because the query is
  // written to the client's stdin and that needs the child object back.
  const call = toolInvocation(binary, args)
  const opts = call.verbatim ? { ...options, windowsVerbatimArguments: true } : options
  return new Promise((resolve, reject) => {
    const child = execFile(call.file, [...call.args], opts, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
    child.stdin?.end(input.endsWith(';') || input.trim().endsWith(';') ? input : `${input};`)
  })
}

/* ---------------- schema introspection ---------------- */

async function introspect(connection: DatabaseConnection): Promise<DatabaseSchema> {
  const sql = INTROSPECTION[connection.kind]
  const result = await runQuery(connection, sql)
  if (result.error) return { connectionId: connection.id, tables: [], error: result.error }

  const byTable = new Map<string, TableInfo>()
  for (const row of result.rows) {
    const [schema, name, kind, column, type, nullable, primaryKey] = row
    if (!name) continue
    const key = `${schema}.${name}`
    const table = byTable.get(key) ?? { schema: schema || '', name, kind: kind || 'table', columns: [] }
    if (column) {
      table.columns.push({
        name: column,
        type: type || '',
        nullable: nullable === 'YES' || nullable === '1' || nullable === 't',
        primaryKey: primaryKey === '1' || primaryKey === 't' || primaryKey === 'YES',
      })
    }
    byTable.set(key, table)
  }

  return {
    connectionId: connection.id,
    tables: Array.from(byTable.values()).sort(
      (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
    ),
  }
}

/**
 * One query per dialect, all returning the same seven columns so `introspect`
 * does not need to branch: schema, table, kind, column, type, nullable, pk.
 */
const INTROSPECTION: Record<DatabaseKind, string> = {
  postgres: `
    SELECT c.table_schema, c.table_name,
           CASE t.table_type WHEN 'VIEW' THEN 'view' ELSE 'table' END,
           c.column_name, c.data_type, c.is_nullable,
           CASE WHEN pk.column_name IS NOT NULL THEN 't' ELSE 'f' END
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    LEFT JOIN (
      SELECT kcu.table_schema, kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
    ) pk ON pk.table_schema = c.table_schema
        AND pk.table_name = c.table_name
        AND pk.column_name = c.column_name
    WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
    ORDER BY c.table_schema, c.table_name, c.ordinal_position;
  `,
  mysql: `
    SELECT c.TABLE_SCHEMA, c.TABLE_NAME,
           CASE t.TABLE_TYPE WHEN 'VIEW' THEN 'view' ELSE 'table' END,
           c.COLUMN_NAME, c.DATA_TYPE, c.IS_NULLABLE,
           CASE WHEN c.COLUMN_KEY = 'PRI' THEN '1' ELSE '0' END
    FROM information_schema.COLUMNS c
    JOIN information_schema.TABLES t
      ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
    WHERE c.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
    ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION;
  `,
  // SQLite has no information_schema; pragma_table_info is the equivalent.
  sqlite: `
    SELECT '' AS sch, m.name, m.type, p.name, p.type, CASE p."notnull" WHEN 0 THEN 'YES' ELSE 'NO' END, CAST(p.pk AS TEXT)
    FROM sqlite_master m
    JOIN pragma_table_info(m.name) p
    WHERE m.type IN ('table','view') AND m.name NOT LIKE 'sqlite_%'
    ORDER BY m.name, p.cid;
  `,
}
