/**
 * Exercises the refactoring engine end to end, offline.
 *
 * Every case runs the real entry point, applies the resulting WorkspaceEdit
 * with the real `applyEdits`, and asserts on the resulting source. The engine
 * is pure by construction, so this covers everything except the dialog.
 */
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const R = await import(pathToFileURL(`${BUILD}/refactor.js`).href)
const { applyEdits } = await import(pathToFileURL(`${BUILD}/applyEdits.js`).href)

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

/** Applies a result's edits to a map of file -> text. */
function applyAll(files, result) {
  if (!result.ok) throw new Error(result.reason)
  const next = { ...files }
  for (const [file, edits] of Object.entries(result.edit.changes ?? {})) {
    next[file] = applyEdits(next[file] ?? '', edits)
  }
  for (const change of result.edit.documentChanges ?? []) {
    if (change.kind === 'rename') {
      next[change.newUri] = next[change.oldUri]
      delete next[change.oldUri]
    } else if (change.kind === 'delete') {
      delete next[change.uri]
    } else if (change.kind === 'create' && next[change.uri] === undefined) {
      next[change.uri] = ''
    }
  }
  return next
}

/** Minimal in-memory workspace: references come from a plain text scan. */
function makeWorkspace(files, root = '/p') {
  const list = () => Object.keys(files)
  return {
    async readFile(path) {
      return files[path] ?? null
    },
    async files() {
      return list()
    },
    async references(name) {
      const out = []
      for (const [file, text] of Object.entries(files)) {
        text.split('\n').forEach((line, index) => {
          const pattern = new RegExp(`\\b${name}\\b`, 'g')
          let match
          while ((match = pattern.exec(line))) {
            const isDeclaration = /^\s*(def|class|func|fn|function|public|private|static|export)\b/.test(line) &&
              new RegExp(`(def|class|func|fn|function)\\s+${name}\\b`).test(line)
            out.push({
              file,
              line: index + 1,
              column: match.index + 1,
              preview: line,
              kind: isDeclaration ? 'declaration' : /^\s*(import|from)\b/.test(line) ? 'import' : 'code',
            })
          }
        })
      }
      return out
    },
    async definitions(name) {
      const out = []
      for (const [file, text] of Object.entries(files)) {
        text.split('\n').forEach((line, index) => {
          const match = new RegExp(`\\b(class|struct|interface|trait)\\s+(${name})\\b`).exec(line)
          if (match) {
            out.push({
              name,
              kind: 'class',
              file,
              line: index + 1,
              column: 1,
              container: '',
              signature: line.trim(),
              language: 'python',
              exported: true,
            })
          }
        })
      }
      return out
    },
    async workspaceSymbols() {
      return []
    },
    root,
  }
}

/** Builds a site whose range covers the first occurrence of `needle`. */
function siteAt(file, language, text, needle, occurrence = 0) {
  let index = -1
  for (let i = 0; i <= occurrence; i++) index = text.indexOf(needle, index + 1)
  if (index === -1) throw new Error(`needle not found: ${needle}`)
  const before = text.slice(0, index)
  const line = before.split('\n').length - 1
  const character = index - (before.lastIndexOf('\n') + 1)
  const endBefore = text.slice(0, index + needle.length)
  return {
    file,
    language,
    text,
    range: {
      start: { line, character },
      end: {
        line: endBefore.split('\n').length - 1,
        character: index + needle.length - (endBefore.lastIndexOf('\n') + 1),
      },
    },
  }
}

/** Caret (empty selection) at the first occurrence of `needle`. */
function caretAt(file, language, text, needle, occurrence = 0) {
  const site = siteAt(file, language, text, needle, occurrence)
  return { ...site, range: { start: site.range.start, end: site.range.start } }
}

/* ================================================================== */

console.log('\n-- lexical core --')
{
  const profile = R.profileFor('typescript')
  const text = `const a = "he said } hi" // brace } here\nif (x) { y() }\n`
  const masked = R.maskLiterals(text, profile)
  const braces = [...masked.mask].filter((c) => c === '}').length
  check('string and comment bodies are masked', braces === 1, `found ${braces} live braces, expected 1`)

  const call = `f(a, g(b, c), "x,y")`
  const m2 = R.maskLiterals(call, profile)
  const parts = R.splitTopLevel(call, m2.mask, 2, call.length - 1)
  check('argument split respects nesting and strings', parts.length === 3, JSON.stringify(parts.map((p) => p.text)))

  const py = R.maskLiterals(`s = """\nclass NotReal:\n"""\nclass Real:\n`, R.profileFor('python'))
  check('python triple quotes are masked', py.mask.split('class').length - 1 === 1)

  const rust = R.maskLiterals(`fn f<'a>(x: &'a str) -> &'a str { x }`, R.profileFor('rust'))
  check("rust lifetimes are not treated as strings", rust.mask.includes('str { x }'))
}

console.log('\n-- extract variable --')
{
  const file = '/p/src/main.py'
  const text = [
    'def run():',
    '    total = compute(items) * 2',
    '    print(compute(items) * 2)',
    '',
  ].join('\n')
  const site = siteAt(file, 'python', text, 'compute(items) * 2')

  const preparation = R.prepareExtract(site, 'variable')
  check('prepare finds both occurrences', preparation.ok && preparation.occurrenceCount === 2, JSON.stringify(preparation))

  const result = R.extractVariable(site, { name: 'scaled', replaceAll: true })
  const out = applyAll({ [file]: text }, result)[file]
  check(
    'declaration is inserted above the first use at the right indent',
    out.includes('    scaled = compute(items) * 2\n    total = scaled'),
    out,
  )
  check('every occurrence is replaced', out.split('scaled').length - 1 === 3, out)
  check('warns about repeated side effects', result.warnings.some((w) => w.includes('side effects')))
}

{
  // Typed language: the declaration keyword and terminator come from the profile.
  const file = '/p/Main.java'
  const text = ['class Main {', '    void run() {', '        use(2 + 3);', '    }', '}', ''].join('\n')
  const result = R.extractVariable(siteAt(file, 'java', text, '2 + 3'), {
    name: 'sum',
    replaceAll: false,
    type: 'int',
  })
  const out = applyAll({ [file]: text }, result)[file]
  check('java local uses its type and semicolon', out.includes('        int sum = 2 + 3;\n        use(sum);'), out)
}

{
  const file = '/p/src/app.ts'
  const text = ['export function run() {', '  send(buildPayload(user))', '}', ''].join('\n')
  const result = R.extractVariable(siteAt(file, 'typescript', text, 'buildPayload(user)'), {
    name: 'payload',
    replaceAll: false,
  })
  const out = applyAll({ [file]: text }, result)[file]
  check('typescript uses const with no terminator', out.includes('  const payload = buildPayload(user)\n  send(payload)'), out)
}

{
  // A bare expression statement must become the declaration, not gain a
  // stranded `name` line underneath it.
  const file = '/p/src/orders.py'
  const text = [
    'class OrderService:',
    '    def create(self, order):',
    '        self.repo.save(order)',
    '        return order',
    '',
  ].join('\n')
  const result = R.extractVariable(siteAt(file, 'python', text, 'self.repo.save(order)'), {
    name: 'saved',
    replaceAll: false,
  })
  const out = applyAll({ [file]: text }, result)[file]
  check('a whole expression statement is replaced, not duplicated', out.includes('        saved = self.repo.save(order)\n        return order'), out)
  check('no stranded expression statement is left behind', !/^\s+saved\s*$/m.test(out), out)
}

console.log('\n-- extract constant --')
{
  const file = '/p/src/app.ts'
  const text = ["import { x } from './x'", '', 'function run() {', '  wait(3000)', '}', ''].join('\n')
  const result = R.extractConstant(siteAt(file, 'typescript', text, '3000'), {
    name: 'TIMEOUT_MS',
    replaceAll: true,
  })
  const out = applyAll({ [file]: text }, result)[file]
  check('constant lands after the import block', /^import.*\nconst TIMEOUT_MS = 3000/m.test(out), out)
  check('use site is replaced', out.includes('wait(TIMEOUT_MS)'), out)
}

console.log('\n-- extract field --')
{
  const file = '/p/src/orders.py'
  const text = [
    'class OrderService:',
    '    def __init__(self, repo):',
    '        self.repo = repo',
    '',
    '    def create(self):',
    '        return build(50)',
    '',
  ].join('\n')
  const result = R.extractField(siteAt(file, 'python', text, 'build(50)'), {
    name: 'default_order',
    replaceAll: true,
  })
  const out = applyAll({ [file]: text }, result)[file]
  check('python field is assigned in __init__', out.includes('        self.default_order = build(50)'), out)
  check('use site becomes self.<field>', out.includes('return self.default_order'), out)
}

{
  const file = '/p/Main.java'
  const text = ['class Main {', '    void run() {', '        use(compute());', '    }', '}', ''].join('\n')
  const result = R.extractField(siteAt(file, 'java', text, 'compute()'), {
    name: 'cached',
    replaceAll: true,
    type: 'int',
  })
  const out = applyAll({ [file]: text }, result)[file]
  check('java field is declared at the top of the class', out.includes('    private final int cached = compute();'), out)
  check('use site becomes this.<field>', out.includes('use(this.cached)'), out)
}

console.log('\n-- extract method --')
{
  const file = '/p/src/main.py'
  const text = [
    'def run(items):',
    '    total = 0',
    '    for item in items:',
    '        total = total + item',
    '    print(total)',
    '',
  ].join('\n')
  const site = siteAt(file, 'python', text, '    for item in items:\n        total = total + item')

  const preparation = R.prepareExtractMethod(site)
  check(
    'prepare detects the inputs and the produced value',
    preparation.ok && preparation.parameters.includes('items') && preparation.parameters.includes('total'),
    JSON.stringify(preparation),
  )

  const result = R.extractMethod(site, {
    name: 'sum_items',
    parameters: [{ name: 'items' }, { name: 'total' }],
    returns: 'total',
  })
  const out = applyAll({ [file]: text }, result)[file]
  check('a def is added after the source function', out.includes('def sum_items(items, total):'), out)
  check('the body moved across', out.includes('    for item in items:\n        total = total + item'), out)
  check('the new function returns the produced value', out.includes('    return total'), out)
  check('the call replaces the selection', out.includes('    total = sum_items(items, total)'), out)
}

{
  const file = '/p/src/app.ts'
  const text = [
    'class Service {',
    '  run(a: number) {',
    '    const b = a * 2',
    '    log(b)',
    '  }',
    '}',
    '',
  ].join('\n')
  const site = siteAt(file, 'typescript', text, '    log(b)')
  const result = R.extractMethod(site, { name: 'report', parameters: [{ name: 'b' }], returns: null })
  const out = applyAll({ [file]: text }, result)[file]
  check('method call uses the receiver', out.includes('this.report(b)'), out)
  check('a private method is generated', out.includes('private report(b) {'), out)
}

{
  const file = '/p/src/main.py'
  const text = ['def run(x):', '    a = x + 1', '    b = x + 2', '    return a + b', ''].join('\n')
  const site = siteAt(file, 'python', text, '    a = x + 1\n    b = x + 2')
  const preparation = R.prepareExtractMethod(site)
  check(
    'refuses when two produced values are still needed',
    !preparation.ok && preparation.reason.includes('only return one value'),
    JSON.stringify(preparation),
  )
}

console.log('\n-- extract parameter --')
{
  const file = '/p/src/main.py'
  const text = ['def run(items):', '    return scale(items, 2)', '', 'run(a)', 'run(b)', ''].join('\n')
  const workspace = makeWorkspace({ [file]: text })
  const site = siteAt(file, 'python', text, '2', 0)

  const withDefault = await R.extractParameter(
    site,
    { name: 'factor', useDefault: true, updateCallSites: false },
    workspace,
  )
  const out = applyAll({ [file]: text }, withDefault)[file]
  check('parameter is appended with a default', out.includes('def run(items, factor=2):'), out)
  check('the body uses the parameter', out.includes('return scale(items, factor)'), out)
  check('call sites are left alone when a default exists', out.includes('run(a)') && out.includes('run(b)'), out)
}

{
  const file = '/p/Main.java'
  const text = [
    'class Main {',
    '    static int run(int items) {',
    '        return scale(items, 2);',
    '    }',
    '    static void main() {',
    '        run(1);',
    '    }',
    '}',
    '',
  ].join('\n')
  const workspace = makeWorkspace({ [file]: text })
  const result = await R.extractParameter(
    siteAt(file, 'java', text, '2', 0),
    { name: 'factor', type: 'int', useDefault: false, updateCallSites: true },
    workspace,
  )
  const out = applyAll({ [file]: text }, result)[file]
  check('java parameter carries its type', out.includes('static int run(int items, int factor)'), out)
  check('the call site gains the argument', out.includes('run(1, 2)'), out)
}

console.log('\n-- inline variable --')
{
  const file = '/p/src/app.ts'
  const text = [
    'function run(a: number) {',
    '  const doubled = a * 2',
    '  send(doubled)',
    '  log(doubled)',
    '}',
    '',
  ].join('\n')
  const site = caretAt(file, 'typescript', text, 'doubled')

  const preparation = R.prepareInlineVariable(site)
  check('prepare reports the value and usages', preparation.ok && preparation.usageCount === 2, JSON.stringify(preparation))

  const result = R.inlineVariable(site, {})
  const out = applyAll({ [file]: text }, result)[file]
  check('usages are replaced, parenthesised', out.includes('send((a * 2))') && out.includes('log((a * 2))'), out)
  check('the declaration is removed', !out.includes('const doubled'), out)
}

{
  const text = ['function run(a) {', '  let x = 1', '  x = 2', '  use(x)', '}', ''].join('\n')
  const result = R.inlineVariable(caretAt('/p/a.js', 'javascript', text, 'x'), {})
  check('refuses a reassigned variable', !result.ok && result.reason.includes('assigned more than once'), JSON.stringify(result))
}

console.log('\n-- inline method --')
{
  const file = '/p/src/app.ts'
  const other = '/p/src/use.ts'
  const files = {
    [file]: ['export function double(n: number) {', '  return n * 2', '}', ''].join('\n'),
    [other]: ['import { double } from "./app"', 'const v = double(3 + 1)', ''].join('\n'),
  }
  const workspace = makeWorkspace(files)
  const site = caretAt(file, 'typescript', files[file], 'double')

  const preparation = await R.prepareInlineMethod(site, workspace)
  check('prepare reads the single-expression body', preparation.ok && preparation.body === 'n * 2', JSON.stringify(preparation))

  const result = await R.inlineMethod(site, { removeDeclaration: true }, workspace)
  const out = applyAll(files, result)
  check('the call is replaced by the substituted body', out[other].includes('const v = ((3 + 1) * 2)'), out[other])
  check('the declaration is removed', !out[file].includes('function double'), out[file])
}

{
  const file = '/p/src/app.ts'
  const files = {
    [file]: ['function big(n) {', '  const a = n * 2', '  return a + 1', '}', 'big(1)', ''].join('\n'),
  }
  const result = await R.prepareInlineMethod(
    caretAt(file, 'typescript', files[file], 'big'),
    makeWorkspace(files),
  )
  check('refuses a multi-statement body', !result.ok && result.reason.includes('single-expression'), JSON.stringify(result))
}

console.log('\n-- change signature --')
{
  const file = '/p/src/app.ts'
  const other = '/p/src/use.ts'
  const files = {
    [file]: ['export function send(url: string, body: string) {', '  post(url, body)', '}', ''].join('\n'),
    [other]: ['send("/a", "one")', 'send("/b", "two")', ''].join('\n'),
  }
  const workspace = makeWorkspace(files)
  const site = caretAt(file, 'typescript', files[file], 'send')

  const preparation = R.prepareChangeSignature(site)
  check(
    'prepare reads names and types',
    preparation.ok && preparation.params.map((p) => `${p.name}:${p.type}`).join(',') === 'url:string,body:string',
    JSON.stringify(preparation),
  )

  // Swap the two parameters, rename one, and add a third with a call-site value.
  const result = await R.changeSignature(
    site,
    {
      name: 'send',
      returnType: '',
      params: [
        { name: 'payload', type: 'string', originalIndex: 1 },
        { name: 'url', type: 'string', originalIndex: 0 },
        { name: 'retries', type: 'number', originalIndex: -1, callSiteValue: '3' },
      ],
    },
    workspace,
  )
  const out = applyAll(files, result)
  check(
    'the declaration is rewritten',
    out[file].includes('function send(payload: string, url: string, retries: number)'),
    out[file],
  )
  check('the renamed parameter is updated in the body', out[file].includes('post(url, payload)'), out[file])
  check('call arguments are permuted and extended', out[other].includes('send("one", "/a", 3)'), out[other])
  check('every call site is rewritten', out[other].includes('send("two", "/b", 3)'), out[other])
}

{
  // Removing a parameter that the body still uses must warn, not silently break.
  const file = '/p/src/app.ts'
  const files = { [file]: ['function f(a, b) {', '  use(a, b)', '}', 'f(1, 2)', ''].join('\n') }
  const result = await R.changeSignature(
    caretAt(file, 'typescript', files[file], 'f'),
    { name: 'f', params: [{ name: 'a', originalIndex: 0 }] },
    makeWorkspace(files),
  )
  check('warns about a removed parameter still in use', result.ok && result.warnings.some((w) => w.includes('still references')), JSON.stringify(result.warnings))
  const out = applyAll(files, result)[file]
  check('the extra argument is dropped at the call site', out.includes('f(1)'), out)
}

{
  // `self` is written in the declaration but never passed, so it must not
  // occupy an argument index when parameters are reordered.
  const file = '/p/src/orders.py'
  const caller = '/p/src/main.py'
  const files = {
    [file]: [
      'class OrderService:',
      '    def create(self, total, currency):',
      '        return pack(total, currency)',
      '',
    ].join('\n'),
    [caller]: ['service.create(42, "gbp")', ''].join('\n'),
  }
  const workspace = makeWorkspace(files)
  const site = caretAt(file, 'python', files[file], 'create')

  const preparation = R.prepareChangeSignature(site)
  check(
    'the implicit receiver is hidden from the parameter list',
    preparation.ok && preparation.params.map((p) => p.name).join(',') === 'total,currency',
    JSON.stringify(preparation.ok ? preparation.params : preparation),
  )

  const result = await R.changeSignature(
    site,
    {
      name: 'create',
      params: [
        { name: 'currency', originalIndex: 1 },
        { name: 'total', originalIndex: 0 },
      ],
    },
    workspace,
  )
  const out = applyAll(files, result)
  check('self is preserved at the front of the declaration', out[file].includes('def create(self, currency, total):'), out[file])
  check('call arguments are permuted without counting self', out[caller].includes('service.create("gbp", 42)'), out[caller])
}

console.log('\n-- introduce parameter object --')
{
  const file = '/p/src/app.ts'
  const files = {
    [file]: [
      'export function draw(x: number, y: number, color: string) {',
      '  paint(x, y, color)',
      '}',
      'draw(1, 2, "red")',
      '',
    ].join('\n'),
  }
  const result = await R.introduceParameterObject(
    caretAt(file, 'typescript', files[file], 'draw'),
    { typeName: 'DrawParams', parameterName: 'params', indices: [0, 1] },
    makeWorkspace(files),
  )
  const out = applyAll(files, result)[file]
  check('an interface is generated', out.includes('interface DrawParams {') && out.includes('  x: number'), out)
  check('the signature folds the chosen parameters', out.includes('function draw(params: DrawParams, color: string)'), out)
  check('the body reads through the object', out.includes('paint(params.x, params.y, color)'), out)
  check('the call site builds the object', out.includes('draw({ x: 1, y: 2 }, "red")'), out)
}

console.log('\n-- safe delete --')
{
  const file = '/p/src/app.ts'
  const other = '/p/src/use.ts'
  const files = {
    [file]: ['export function used() {', '  return 1', '}', ''].join('\n'),
    [other]: ['used()', ''].join('\n'),
  }
  const workspace = makeWorkspace(files)
  const blocked = await R.safeDelete(caretAt(file, 'typescript', files[file], 'used'), {}, workspace)
  check('refuses while references remain', !blocked.ok && blocked.reason.includes('still used'), JSON.stringify(blocked))

  const forced = await R.safeDelete(
    caretAt(file, 'typescript', files[file], 'used'),
    { force: true },
    workspace,
  )
  const out = applyAll(files, forced)[file]
  check('force removes the declaration', !out.includes('function used'), out)
  check('force warns about what will break', forced.warnings.some((w) => w.includes('will break')), JSON.stringify(forced.warnings))
}

{
  const file = '/p/src/dead.ts'
  const files = { [file]: ['export function unused() {', '  return 1', '}', ''].join('\n') }
  const result = await R.safeDelete(
    caretAt(file, 'typescript', files[file], 'unused'),
    {},
    makeWorkspace(files),
  )
  check('an unreferenced symbol deletes cleanly', result.ok, JSON.stringify(result))
}

console.log('\n-- pull up / push down --')
{
  const base = '/p/src/base.py'
  const child = '/p/src/child.py'
  const files = {
    [base]: ['class Base:', '    def shared(self):', '        return 1', ''].join('\n'),
    [child]: [
      'from base import Base',
      '',
      'class Child(Base):',
      '    def only_here(self):',
      '        return 2',
      '',
    ].join('\n'),
  }
  const workspace = makeWorkspace(files)
  const site = caretAt(child, 'python', files[child], 'only_here')

  const preparation = await R.prepareMembers(site, 'up', workspace)
  check(
    'the base class is resolved from the header',
    preparation.ok && preparation.targets.some((t) => t.name === 'Base'),
    JSON.stringify(preparation),
  )

  const result = await R.moveMembers(
    site,
    { direction: 'up', targets: preparation.ok ? [preparation.targets[0]] : [] },
    workspace,
  )
  const out = applyAll(files, result)
  check('the member arrives in the base class', out[base].includes('    def only_here(self):'), out[base])
  check('the member leaves the subclass', !out[child].includes('def only_here'), out[child])
}

{
  const files = {
    '/p/src/base.py': ['class Base:', '    def shared(self):', '        return 1', ''].join('\n'),
    '/p/src/child.py': ['from base import Base', '', 'class Child(Base):', '    pass', ''].join('\n'),
  }
  const workspace = makeWorkspace(files)
  const preparation = await R.prepareMembers(
    caretAt('/p/src/base.py', 'python', files['/p/src/base.py'], 'shared'),
    'down',
    workspace,
  )
  check(
    'subclasses are found by scanning class headers',
    preparation.ok && preparation.targets.some((t) => t.name === 'Child'),
    JSON.stringify(preparation),
  )
}

console.log('\n-- move file --')
{
  const moved = '/p/src/util.ts'
  const importer = '/p/src/app/main.ts'
  const files = {
    [moved]: ["import { helper } from './helpers/one'", 'export const x = helper', ''].join('\n'),
    [importer]: ["import { x } from '../util'", 'use(x)', ''].join('\n'),
  }
  const workspace = makeWorkspace(files)
  const result = await R.moveFile(
    { file: moved, language: 'typescript', text: files[moved], range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { targetDir: '/p/src/lib', root: '/p', updateImports: true },
    workspace,
  )
  const out = applyAll(files, result)
  check('the file is renamed', out['/p/src/lib/util.ts'] !== undefined && out[moved] === undefined, Object.keys(out).join(', '))
  check(
    "the importer's specifier is recomputed",
    out[importer].includes("from '../lib/util'"),
    out[importer],
  )
  check(
    "the moved file's own imports are recomputed",
    out['/p/src/lib/util.ts'].includes("from '../helpers/one'"),
    out['/p/src/lib/util.ts'],
  )
}

{
  // macOS hands the same file back as both /var/… and /private/var/… — the
  // engine must treat those as one path or every rewrite is silently skipped.
  const moved = '/var/proj/src/util.ts'
  const importer = '/private/var/proj/src/app/main.ts'
  const files = {
    [moved]: 'export const helper = 1\n',
    [importer]: "import { helper } from '../util'\nuse(helper)\n",
  }
  const result = await R.moveFile(
    { file: moved, language: 'typescript', text: files[moved], range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { targetDir: '/var/proj/src/lib', root: '/var/proj', updateImports: true },
    makeWorkspace(files),
  )
  const out = applyAll(files, result)
  check(
    'symlinked path prefixes still match (/var vs /private/var)',
    out[importer].includes("from '../lib/util'"),
    out[importer],
  )
}

{
  const moved = '/p/src/orders.py'
  const importer = '/p/src/main.py'
  const files = {
    [moved]: ['class OrderService:', '    pass', ''].join('\n'),
    [importer]: ['from src.orders import OrderService', 'x = OrderService()', ''].join('\n'),
  }
  const result = await R.moveFile(
    { file: moved, language: 'python', text: files[moved], range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { targetDir: '/p/src/domain', root: '/p', updateImports: true },
    makeWorkspace(files),
  )
  const out = applyAll(files, result)
  check('python dotted imports are rewritten', out[importer].includes('from src.domain.orders import'), out[importer])
}

{
  // A language without resolvable imports still moves, with a warning.
  const moved = '/p/src/util.go'
  const files = { [moved]: 'package util\n' }
  const result = await R.moveFile(
    { file: moved, language: 'go', text: files[moved], range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } },
    { targetDir: '/p/internal', root: '/p', updateImports: true },
    makeWorkspace(files),
  )
  check(
    'unsupported import systems are called out rather than guessed',
    result.ok && result.warnings.some((w) => w.includes('not updated')),
    JSON.stringify(result.warnings),
  )
}

console.log('\n-- move class --')
{
  const source = '/p/src/models.ts'
  const target = '/p/src/order.ts'
  const files = {
    [source]: ['export class Order {', '  id = 1', '}', '', 'export const first = new Order()', ''].join('\n'),
  }
  const result = await R.moveClass(
    caretAt(source, 'typescript', files[source], 'Order'),
    { targetFile: target, root: '/p' },
    makeWorkspace(files),
  )
  const out = applyAll(files, result)
  check('the class body lands in the target file', out[target].includes('export class Order {'), out[target])
  check('it leaves the source file', !out[source].includes('class Order {'), out[source])
  check('the source gains an import because it still uses it', out[source].includes("import { Order } from './order'"), out[source])
}

console.log('\n-- guard rails --')
{
  const result = R.extractVariable(
    siteAt('/p/a.txt', 'plaintext', 'hello world\n', 'world'),
    { name: 'w', replaceAll: false },
  )
  check('unsupported languages refuse clearly', !result.ok && result.reason.includes('not available'), JSON.stringify(result))
}
{
  const text = 'function f() {\n  const a = 1;\n  const b = 2;\n}\n'
  const result = R.extractVariable(siteAt('/p/a.ts', 'typescript', text, 'a = 1;\n  const b = 2'), {
    name: 'x',
    replaceAll: false,
  })
  check('a multi-statement selection is refused', !result.ok, JSON.stringify(result))
}
{
  const result = R.extractVariable(siteAt('/p/a.ts', 'typescript', 'const a = f(1)\n', 'f(1'), {
    name: 'x',
    replaceAll: false,
  })
  check('an unbalanced selection is refused', !result.ok && result.reason.includes('balanced'), JSON.stringify(result))
}
{
  const result = R.extractVariable(siteAt('/p/a.ts', 'typescript', 'const a = 1\n', '1'), {
    name: '2bad',
    replaceAll: false,
  })
  check('an invalid identifier is refused', !result.ok && result.reason.includes('not a valid identifier'), JSON.stringify(result))
}
{
  const available = R.availableRefactorings({ language: 'plaintext' }, true)
  const enabled = available.filter((entry) => entry.enabled).map((entry) => entry.descriptor.id)
  check(
    'only text-safe refactorings are offered without a profile',
    enabled.length === 2 && enabled.includes('move.file') && enabled.includes('safeDelete'),
    enabled.join(', '),
  )
}
{
  const available = R.availableRefactorings({ language: 'typescript' }, false)
  const extract = available.find((entry) => entry.descriptor.id === 'extract.variable')
  check('extract is disabled without a selection', !extract.enabled && extract.reason.includes('select'), JSON.stringify(extract))
}

console.log(`\nrefactor: ${passed}/${passed + failed} passed`)
if (failed) process.exit(1)
