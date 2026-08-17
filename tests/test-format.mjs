/**
 * The built-in formatter, Optimize Imports and the EditorConfig reader.
 *
 * All three are pure, so they run against the real entry points with no editor
 * and no file system beyond a temporary directory for `.editorconfig`.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const F = await import(pathToFileURL(`${BUILD}/format.js`).href)
const I = await import(pathToFileURL(`${BUILD}/imports.js`).href)
const EC = await import(pathToFileURL(`${BUILD}/editorConfig.js`).href)

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

const STYLE = {
  indentSize: 2,
  useTabs: false,
  maxLineLength: 100,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  maxBlankLines: 2,
  reindent: true,
  normalizeSpacing: true,
  importOrder: 'alphabetical',
  removeUnusedImports: true,
  groupImports: true,
  endOfLine: 'lf',
}

console.log('\n-- formatter --')
{
  const text = ['function f() {', 'let a = 1', '    if (a) {', 'return a', '}', '}'].join('\n')
  const out = F.formatText(text, { style: STYLE, language: 'typescript' })
  check(
    'braces drive the indentation',
    out === 'function f() {\n  let a = 1\n  if (a) {\n    return a\n  }\n}\n',
    JSON.stringify(out),
  )
}
{
  const text = 'call(\na,\nb\n)\n'
  const out = F.formatText(text, { style: STYLE, language: 'typescript' })
  check('a wrapped argument list indents one step', out === 'call(\n  a,\n  b\n)\n', JSON.stringify(out))
}
{
  const text = 'const s = "a{b"\nconst t = 1\n'
  const out = F.formatText(text, { style: STYLE, language: 'typescript' })
  check('a brace inside a string does not open a block', out === text, JSON.stringify(out))
}
{
  const text = 'const a = [1 ,2 ,  3]\n'
  const out = F.formatText(text, { style: STYLE, language: 'typescript' })
  check('comma spacing is normalised', out === 'const a = [1, 2, 3]\n', JSON.stringify(out))
}
{
  const text = 'const s = "a ,b"\n'
  const out = F.formatText(text, { style: STYLE, language: 'typescript' })
  check('comma spacing inside a string is left alone', out === text, JSON.stringify(out))
}
{
  const text = 'a\n\n\n\n\nb\n'
  const out = F.formatText(text, { style: STYLE, language: 'typescript' })
  check('blank line runs are collapsed', out === 'a\n\n\nb\n', JSON.stringify(out))
}
{
  const text = 'def f():\n        return 1\n'
  const out = F.formatText(text, { style: STYLE, language: 'python' })
  check('an indentation-scoped language is never re-indented', out === text, JSON.stringify(out))
}
{
  const text = 'function f() {\nreturn 1\n}\n'
  const out = F.formatText(text, { style: { ...STYLE, useTabs: true }, language: 'go' })
  check('tabs are honoured', out === 'function f() {\n\treturn 1\n}\n', JSON.stringify(out))
}
{
  const text = 'switch (a) {\ncase 1:\nbreak\n}\n'
  const out = F.formatText(text, { style: STYLE, language: 'typescript' })
  check('case labels sit one step out', out === 'switch (a) {\ncase 1:\n  break\n}\n', JSON.stringify(out))
}
{
  const text = 'a = 1\r\nb = 2\r\n'
  const out = F.formatText(text, { style: { ...STYLE, endOfLine: 'crlf' }, language: 'typescript' })
  check('crlf survives when the style asks for it', out === 'a = 1\r\nb = 2\r\n', JSON.stringify(out))
}
{
  check('isFormatted reports a no-op', F.isFormatted('const a = 1\n', { style: STYLE, language: 'typescript' }))
}

console.log('\n-- optimize imports --')
{
  const text = [
    "import { readFile, writeFile } from 'fs'",
    "import path from 'path'",
    '',
    'readFile()',
    'path.join()',
  ].join('\n')
  const result = I.optimizeImports(text, 'typescript', STYLE)
  check(
    'an unused named specifier is dropped',
    result.ok && result.text.includes("import { readFile } from 'fs'") && result.removed.includes('writeFile'),
    JSON.stringify(result),
  )
}
{
  const text = ["import { a } from 'x'", "import { b } from 'y'", '', 'b()'].join('\n')
  const result = I.optimizeImports(text, 'typescript', STYLE)
  check(
    'a wholly unused statement disappears',
    result.ok && !result.text.includes("from 'x'") && result.text.includes("from 'y'"),
    result.text,
  )
}
{
  const text = ["import './styles.css'", "import { b } from 'y'", '', 'b()'].join('\n')
  const result = I.optimizeImports(text, 'typescript', STYLE)
  check('a side-effect import is never removed', result.ok && result.text.includes("import './styles.css'"), result.text)
}
{
  const text = ["import { b } from 'zoo'", "import { a } from 'apple'", '', 'a(); b()'].join('\n')
  const result = I.optimizeImports(text, 'typescript', STYLE)
  check(
    'imports are sorted alphabetically',
    result.ok && result.text.indexOf("'apple'") < result.text.indexOf("'zoo'"),
    result.text,
  )
}
{
  const text = ["import { a } from './local'", "import { b } from 'pkg'", '', 'a(); b()'].join('\n')
  const result = I.optimizeImports(text, 'typescript', STYLE)
  const external = result.text.indexOf("'pkg'")
  const project = result.text.indexOf("'./local'")
  check('external imports are grouped before project ones', result.ok && external < project, result.text)
}
{
  const text = ["// eslint-disable-next-line", "import { a } from 'x'", "import { b } from 'y'", '', 'a(); b()'].join('\n')
  const result = I.optimizeImports(text, 'typescript', STYLE)
  check(
    'a comment travels with the import it annotates',
    result.ok && /\/\/ eslint-disable-next-line\nimport \{ a \} from 'x'/.test(result.text),
    result.text,
  )
}
{
  const text = ['from os import path, sep', '', 'print(path)'].join('\n')
  const result = I.optimizeImports(text, 'python', STYLE)
  check(
    'python from-imports are pruned',
    result.ok && result.text.includes('from os import path') && result.removed.includes('sep'),
    result.text,
  )
}
{
  const text = ['import "fmt"', '', 'func main() { fmt.Println() }'].join('\n')
  const result = I.optimizeImports(text, 'go', STYLE)
  check('a used go import survives', result.ok && result.text.includes('"fmt"'), result.text)
}
{
  const text = ['import (', '\t"fmt"', '\t"os"', ')', '', 'func main() { fmt.Println() }'].join('\n')
  const result = I.optimizeImports(text, 'go', STYLE)
  check(
    'an unused go import is removed — it would not compile otherwise',
    result.ok && result.text.includes('"fmt"') && !result.text.includes('"os"'),
    result.text,
  )
}
{
  const text = ['import java.util.List;', 'import java.util.Map;', '', 'class A { List x; }'].join('\n')
  const result = I.optimizeImports(text, 'java', STYLE)
  check('an unused java import is removed', result.ok && !result.text.includes('Map'), result.text)
}
{
  const text = ['import java.util.*;', '', 'class A {}'].join('\n')
  const result = I.optimizeImports(text, 'java', STYLE)
  check('a wildcard import is kept — its bindings are unknowable', result.ok && result.text.includes('java.util.*'), result.text)
}
{
  const text = ['import Foundation', 'import UIKit', '', 'let a = 1'].join('\n')
  const result = I.optimizeImports(text, 'swift', STYLE)
  check(
    'swift imports are sorted but never removed',
    result.ok && result.text.includes('Foundation') && result.text.includes('UIKit'),
    result.text,
  )
}
{
  const result = I.optimizeImports('x = 1\n', 'lisp', STYLE)
  check('an unknown language refuses clearly', !result.ok && result.reason.includes('does not know'), JSON.stringify(result))
}

console.log('\n-- editorconfig --')
{
  const parsed = EC.parseEditorConfig(
    ['root = true', '', '[*]', 'indent_style = space', 'indent_size = 4', '', '[*.go]', 'indent_style = tab'].join('\n'),
  )
  check('root and sections are read', parsed.root && parsed.sections.length === 2, JSON.stringify(parsed))
}
{
  check('a bare glob matches at any depth', EC.globToRegExp('*.ts').test('src/a/b.ts'))
  check('a rooted glob is anchored', !EC.globToRegExp('/src/*.ts').test('lib/a.ts'))
  check('** crosses directories', EC.globToRegExp('src/**/*.ts').test('src/a/b/c.ts'))
  check('** matches zero directories', EC.globToRegExp('src/**/*.ts').test('src/c.ts'))
  check('braces alternate', EC.globToRegExp('*.{js,ts}').test('a.ts') && EC.globToRegExp('*.{js,ts}').test('a.js'))
  check('a non-matching extension is rejected', !EC.globToRegExp('*.{js,ts}').test('a.py'))
}
{
  const root = await mkdtemp(path.join(tmpdir(), 'nova-ec-'))
  await writeFile(
    path.join(root, '.editorconfig'),
    ['root = true', '[*]', 'indent_style = space', 'indent_size = 2', '[*.go]', 'indent_style = tab', 'indent_size = 4'].join('\n'),
  )
  await mkdir(path.join(root, 'src'), { recursive: true })
  const ts = await EC.resolveEditorConfig(path.join(root, 'src', 'a.ts'), root)
  const go = await EC.resolveEditorConfig(path.join(root, 'src', 'a.go'), root)
  check('the generic section applies', ts?.indent_style === 'space' && ts?.indent_size === '2', JSON.stringify(ts))
  check('a more specific section wins', go?.indent_style === 'tab' && go?.indent_size === '4', JSON.stringify(go))
  const none = await EC.resolveEditorConfig(path.join(tmpdir(), 'nowhere-at-all', 'a.ts'), path.join(tmpdir(), 'nowhere-at-all'))
  check('no config resolves to null', none === null, JSON.stringify(none))
}

console.log(`\nformat: ${passed}/${passed + failed} passed`)
if (failed) process.exit(1)
