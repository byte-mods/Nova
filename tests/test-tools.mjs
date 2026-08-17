/**
 * The pure halves of the newer tooling: batch inspections and Code Cleanup,
 * postfix completion, the SQL helpers behind the editable grid, the generated
 * diagrams, and run-configuration composition.
 */
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const INS = await import(pathToFileURL(`${BUILD}/inspections.js`).href)
const PF = await import(pathToFileURL(`${BUILD}/postfix.js`).href)
const SQL = await import(pathToFileURL(`${BUILD}/sqlTools.js`).href)
const DIA = await import(pathToFileURL(`${BUILD}/codeDiagrams.js`).href)
const RC = await import(pathToFileURL(`${BUILD}/runConfigs.js`).href)

let passed = 0
let failed = 0

function check(label, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail.replace(/\n/g, '\n        ')}` : ''}`)
  }
}

console.log('\n-- batch inspections --')
{
  const findings = INS.inspectText('/p/a.ts', 'const x = 1\ndebugger\n')
  check(
    'a rule fires with its file and line',
    findings.some((f) => f.ruleId === 'debugger-statement' && f.line === 2 && f.file === '/p/a.ts'),
    JSON.stringify(findings),
  )
}
{
  const findings = INS.inspectText('/p/a.ts', 'debugger\n', { 'debugger-statement': 'off' })
  check('a rule set to off does not fire', findings.length === 0, JSON.stringify(findings))
}
{
  const findings = INS.inspectText('/p/a.ts', '// nova-ignore debugger-statement\ndebugger\n')
  check('nova-ignore suppresses the rule', findings.every((f) => f.ruleId !== 'debugger-statement'))
}
{
  const findings = INS.inspectText('/p/a.py', 'debugger\n')
  check('a JS-only rule skips a .py file', findings.every((f) => f.ruleId !== 'debugger-statement'))
}
{
  const findings = INS.inspectText('/p/a.ts', '// this will recieve the paramter\n')
  const messages = findings.filter((f) => f.ruleId === 'typo').map((f) => f.message)
  check(
    'the spellchecker catches misspellings in comments',
    messages.some((m) => m.includes('receive')) && messages.some((m) => m.includes('parameter')),
    JSON.stringify(messages),
  )
}
{
  const findings = INS.inspectText('/p/a.ts', 'const seperateValue = 1\n')
  check(
    'the spellchecker splits camelCase identifiers',
    findings.some((f) => f.ruleId === 'typo' && f.message.includes('separate')),
    JSON.stringify(findings.map((f) => f.message)),
  )
}
{
  const findings = INS.inspectText('/p/a.ts', 'const receiver = 1\nconst separator = 2\n')
  check('correctly spelled words are not flagged', findings.every((f) => f.ruleId !== 'typo'))
}
{
  const result = INS.cleanupText('/p/a.py', 'try:\n    pass\nexcept:\n    pass\n')
  check(
    'Code Cleanup applies a mechanical fix',
    result.applied === 1 && result.text.includes('except Exception:'),
    JSON.stringify(result),
  )
}
{
  const result = INS.cleanupText('/p/a.ts', 'debugger\n')
  check(
    'Code Cleanup leaves delete-line fixes alone',
    result.applied === 0 && result.text === 'debugger\n',
    JSON.stringify(result),
  )
}

console.log('\n-- postfix completion --')
{
  const site = PF.postfixSiteAt('  user.isAdmin.if', 18)
  check('the expression before the dot is captured', site?.expression === 'user.isAdmin' && site.typed === 'if', JSON.stringify(site))
}
{
  const site = PF.postfixSiteAt('items[0].name.log', 18)
  check('bracket groups are included', site?.expression === 'items[0].name', JSON.stringify(site))
}
{
  const site = PF.postfixSiteAt('const a = b + c.no', 19)
  check('the scan stops at an operator', site?.expression === 'c', JSON.stringify(site))
}
{
  check('no dot means no site', PF.postfixSiteAt('const a = 1', 12) === null)
}
{
  const templates = PF.postfixTemplatesFor('typescript')
  const ifTemplate = templates.find((t) => t.key === 'if')
  check('the if template wraps the expression', ifTemplate.render('ready', '').startsWith('if (ready) {'), ifTemplate.render('ready', ''))
  const notTemplate = templates.find((t) => t.key === 'not')
  check('not parenthesises a compound expression', notTemplate.render('a || b', '') === '!(a || b)$0', notTemplate.render('a || b', ''))
}
{
  check('a language with no templates returns none', PF.postfixTemplatesFor('cobol').length === 0)
}

console.log('\n-- sql tools --')
const SCHEMA = {
  connectionId: 'c1',
  tables: [
    {
      schema: 'public',
      name: 'orders',
      kind: 'table',
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey: true },
        { name: 'customer_id', type: 'integer', nullable: false, primaryKey: false },
        { name: 'total', type: 'numeric', nullable: true, primaryKey: false },
      ],
    },
    {
      schema: 'public',
      name: 'customers',
      kind: 'table',
      columns: [{ name: 'id', type: 'integer', nullable: false, primaryKey: true }],
    },
  ],
}
{
  const suggestions = SQL.sqlCompletions('SELECT * FROM ord', SCHEMA)
  check(
    'tables are suggested after FROM',
    suggestions[0]?.kind === 'table' && suggestions[0].label === 'orders',
    JSON.stringify(suggestions.slice(0, 2)),
  )
}
{
  const suggestions = SQL.sqlCompletions('SELECT * FROM orders WHERE cust', SCHEMA)
  check(
    'columns of the statement’s table are suggested',
    suggestions.some((s) => s.kind === 'column' && s.label === 'customer_id'),
    JSON.stringify(suggestions.slice(0, 3)),
  )
}
{
  const suggestions = SQL.sqlCompletions('SELECT orders.', SCHEMA)
  check(
    'a qualified prefix lists only that table’s columns',
    suggestions.length === 3 && suggestions.every((s) => s.kind === 'column'),
    JSON.stringify(suggestions),
  )
}
{
  const target = SQL.editableTarget('SELECT id, total FROM orders', ['id', 'total'], SCHEMA)
  check('a single-table select with its PK is editable', target?.table.name === 'orders' && target.pkIndexes[0] === 0, JSON.stringify(target))
}
{
  check(
    'a select without the primary key is not editable',
    SQL.editableTarget('SELECT total FROM orders', ['total'], SCHEMA) === null,
  )
  check(
    'a join is not editable',
    SQL.editableTarget('SELECT id FROM orders JOIN customers ON 1=1', ['id'], SCHEMA) === null,
  )
}
{
  const target = SQL.editableTarget('SELECT id, total FROM orders', ['id', 'total'], SCHEMA)
  const statements = SQL.buildUpdates(target, ['id', 'total'], [['7', '10']], [{ row: 0, column: 1, value: '12.5' }])
  check(
    'an UPDATE is generated against the primary key',
    statements.length === 1 && statements[0] === 'UPDATE orders SET total = 12.5 WHERE id = 7;',
    JSON.stringify(statements),
  )
}
{
  const target = SQL.editableTarget('SELECT id, total FROM orders', ['id', 'total'], SCHEMA)
  const statements = SQL.buildUpdates(target, ['id', 'total'], [['7', '10']], [{ row: 0, column: 1, value: "it's" }])
  check('string values are escaped', statements[0].includes("'it''s'"), statements[0])
}
{
  const ddl = SQL.generateDdl(SCHEMA, 'postgres')
  check(
    'DDL is generated with the primary key',
    ddl.includes('CREATE TABLE orders (') && ddl.includes('id integer NOT NULL PRIMARY KEY'),
    ddl,
  )
}
{
  const other = JSON.parse(JSON.stringify(SCHEMA))
  other.tables[0].columns.push({ name: 'note', type: 'text', nullable: true, primaryKey: false })
  other.tables.pop()
  const diff = SQL.diffSchemas(SCHEMA, other, 'postgres')
  check(
    'the diff reports added columns and removed tables',
    diff.includes('ADD COLUMN note text') && diff.includes('customers'),
    diff,
  )
  check('an identical diff says so', SQL.diffSchemas(SCHEMA, SCHEMA, 'postgres').includes('identical'))
}

console.log('\n-- generated diagrams --')
{
  const symbols = [
    { name: 'Base', kind: 'class', file: '/p/a.ts', line: 1, column: 1, container: '', signature: 'export class Base {', language: 'typescript', exported: true },
    { name: 'Child', kind: 'class', file: '/p/a.ts', line: 10, column: 1, container: '', signature: 'export class Child extends Base {', language: 'typescript', exported: true },
    { name: 'run', kind: 'method', file: '/p/a.ts', line: 11, column: 3, container: 'Child', signature: 'run() {', language: 'typescript', exported: true },
  ]
  const diagram = DIA.generateClassDiagram(symbols)
  check('classes and members are emitted', diagram.includes('class Child {') && diagram.includes('+run()'), diagram)
  check('inheritance becomes an edge', diagram.includes('Base <|-- Child'), diagram)
}
{
  const files = [
    { path: '/p/src/lib/a.ts', text: "import { x } from '../components/b'\n" },
    { path: '/p/src/components/b.ts', text: 'export const x = 1\n' },
  ]
  const graph = DIA.buildModuleGraph('/p', files)
  check(
    'relative imports become module edges',
    graph.edges.get('src/lib')?.get('src/components') === 1,
    JSON.stringify([...graph.edges])
  )
  check('the mermaid graph names both modules', DIA.generateModuleDiagram(graph).includes('src/components'))
}
{
  const files = [
    { path: '/p/src/a/one.ts', text: "import '../b/two'\n" },
    { path: '/p/src/b/two.ts', text: "import '../a/one'\n" },
  ]
  const graph = DIA.buildModuleGraph('/p', files)
  const dsm = DIA.generateDsm(graph)
  check('the DSM flags a cycle', dsm.includes('⚠') && dsm.includes('Cyclic dependencies'), dsm)
}

console.log('\n-- run configurations --')
{
  const entry = { name: 'Dev', command: 'npm run dev', args: '--port 3001', env: { NODE_ENV: 'development' } }
  check(
    'env, command and args compose in order',
    RC.composeCommand(entry, [entry]) === 'NODE_ENV=development npm run dev --port 3001',
    RC.composeCommand(entry, [entry]),
  )
}
{
  const entry = { name: 'Dev', command: 'npm start', before: ['npm run build'] }
  check(
    'before-launch steps gate the main command',
    RC.composeCommand(entry, [entry]) === 'npm run build && npm start',
    RC.composeCommand(entry, [entry]),
  )
}
{
  const entry = { name: 'Web', command: 'npm start', cwd: 'packages/web' }
  check(
    'a working directory becomes a subshell',
    RC.composeCommand(entry, [entry]) === '(cd packages/web && npm start)',
    RC.composeCommand(entry, [entry]),
  )
}
{
  const api = { name: 'API', command: 'npm run api' }
  const web = { name: 'Web', command: 'npm run web' }
  const both = { name: 'Both', compound: ['API', 'Web'] }
  const composed = RC.composeCommand(both, [api, web, both])
  check(
    'a compound runs its members in parallel and waits',
    composed === '(npm run api) & (npm run web) & wait',
    composed,
  )
}
{
  const entry = { name: 'Quoted', command: 'echo', args: 'x', env: { MSG: 'hello world' } }
  check('values needing quotes get them', RC.composeCommand(entry, [entry]).includes("MSG='hello world'"), RC.composeCommand(entry, [entry]))
}

console.log(`\ntools: ${passed}/${passed + failed} passed`)
if (failed) process.exit(1)
