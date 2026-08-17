/**
 * Postfix completion: type an expression, then a dot, then a template name,
 * and the template wraps the expression — `user.isAdmin.if` → `if (user.isAdmin) { … }`.
 *
 * The expression is read backwards from the dot with a bracket-aware scan, so
 * `items[0].name.log` wraps `items[0].name`, not just `name`. Templates are
 * per language family, and each renders a Monaco snippet (`$0` is the caret).
 */

export interface PostfixTemplate {
  key: string
  detail: string
  /** Renders the replacement snippet for the captured expression. */
  render: (expr: string, indent: string) => string
}

const TS: PostfixTemplate[] = [
  { key: 'if', detail: 'if (expr)', render: (e) => `if (${e}) {\n\t$0\n}` },
  { key: 'else', detail: 'if (!expr)', render: (e) => `if (!${wrap(e)}) {\n\t$0\n}` },
  { key: 'not', detail: '!expr', render: (e) => `!${wrap(e)}$0` },
  { key: 'const', detail: 'const x = expr', render: (e) => `const \${1:value} = ${e}$0` },
  { key: 'let', detail: 'let x = expr', render: (e) => `let \${1:value} = ${e}$0` },
  { key: 'var', detail: 'const x = expr', render: (e) => `const \${1:value} = ${e}$0` },
  { key: 'log', detail: 'console.log(expr)', render: (e) => `console.log(${e})$0` },
  { key: 'error', detail: 'console.error(expr)', render: (e) => `console.error(${e})$0` },
  { key: 'return', detail: 'return expr', render: (e) => `return ${e}$0` },
  { key: 'await', detail: 'await expr', render: (e) => `await ${e}$0` },
  { key: 'for', detail: 'for…of', render: (e) => `for (const \${1:item} of ${e}) {\n\t$0\n}` },
  { key: 'foreach', detail: 'expr.forEach', render: (e) => `${e}.forEach((\${1:item}) => {\n\t$0\n})` },
  { key: 'map', detail: 'expr.map', render: (e) => `${e}.map((\${1:item}) => $0)` },
  { key: 'null', detail: 'if (expr == null)', render: (e) => `if (${e} == null) {\n\t$0\n}` },
  { key: 'notnull', detail: 'if (expr != null)', render: (e) => `if (${e} != null) {\n\t$0\n}` },
  { key: 'try', detail: 'try { expr }', render: (e) => `try {\n\t${e}$0\n} catch (error) {\n\t\n}` },
  { key: 'throw', detail: 'throw expr', render: (e) => `throw ${e}$0` },
  { key: 'json', detail: 'JSON.stringify(expr)', render: (e) => `JSON.stringify(${e}, null, 2)$0` },
]

const PYTHON: PostfixTemplate[] = [
  { key: 'if', detail: 'if expr:', render: (e) => `if ${e}:\n\t$0` },
  { key: 'ifnot', detail: 'if not expr:', render: (e) => `if not ${e}:\n\t$0` },
  { key: 'not', detail: 'not expr', render: (e) => `not ${e}$0` },
  { key: 'var', detail: 'x = expr', render: (e) => `\${1:value} = ${e}$0` },
  { key: 'print', detail: 'print(expr)', render: (e) => `print(${e})$0` },
  { key: 'return', detail: 'return expr', render: (e) => `return ${e}$0` },
  { key: 'for', detail: 'for item in expr:', render: (e) => `for \${1:item} in ${e}:\n\t$0` },
  { key: 'len', detail: 'len(expr)', render: (e) => `len(${e})$0` },
  { key: 'none', detail: 'if expr is None:', render: (e) => `if ${e} is None:\n\t$0` },
  { key: 'notnone', detail: 'if expr is not None:', render: (e) => `if ${e} is not None:\n\t$0` },
]

const GO: PostfixTemplate[] = [
  { key: 'if', detail: 'if expr {', render: (e) => `if ${e} {\n\t$0\n}` },
  { key: 'not', detail: '!expr', render: (e) => `!${wrap(e)}$0` },
  { key: 'var', detail: 'x := expr', render: (e) => `\${1:value} := ${e}$0` },
  { key: 'return', detail: 'return expr', render: (e) => `return ${e}$0` },
  { key: 'for', detail: 'for range', render: (e) => `for _, \${1:item} := range ${e} {\n\t$0\n}` },
  { key: 'print', detail: 'fmt.Println(expr)', render: (e) => `fmt.Println(${e})$0` },
  { key: 'err', detail: 'if err != nil', render: (e) => `if ${e} != nil {\n\t$0\n}` },
  { key: 'nil', detail: 'if expr == nil', render: (e) => `if ${e} == nil {\n\t$0\n}` },
]

const JAVA: PostfixTemplate[] = [
  { key: 'if', detail: 'if (expr)', render: (e) => `if (${e}) {\n\t$0\n}` },
  { key: 'not', detail: '!expr', render: (e) => `!${wrap(e)}$0` },
  { key: 'var', detail: 'var x = expr', render: (e) => `var \${1:value} = ${e};$0` },
  { key: 'return', detail: 'return expr', render: (e) => `return ${e};$0` },
  { key: 'sout', detail: 'System.out.println(expr)', render: (e) => `System.out.println(${e});$0` },
  { key: 'for', detail: 'for (var item : expr)', render: (e) => `for (var \${1:item} : ${e}) {\n\t$0\n}` },
  { key: 'null', detail: 'if (expr == null)', render: (e) => `if (${e} == null) {\n\t$0\n}` },
  { key: 'notnull', detail: 'if (expr != null)', render: (e) => `if (${e} != null) {\n\t$0\n}` },
]

const RUST: PostfixTemplate[] = [
  { key: 'if', detail: 'if expr {', render: (e) => `if ${e} {\n\t$0\n}` },
  { key: 'not', detail: '!expr', render: (e) => `!${wrap(e)}$0` },
  { key: 'let', detail: 'let x = expr;', render: (e) => `let \${1:value} = ${e};$0` },
  { key: 'return', detail: 'return expr;', render: (e) => `return ${e};$0` },
  { key: 'println', detail: 'println!("{:?}", expr)', render: (e) => `println!("{:?}", ${e});$0` },
  { key: 'for', detail: 'for item in expr', render: (e) => `for \${1:item} in ${e} {\n\t$0\n}` },
  { key: 'match', detail: 'match expr', render: (e) => `match ${e} {\n\t$0\n}` },
  { key: 'some', detail: 'if let Some(x) = expr', render: (e) => `if let Some(\${1:value}) = ${e} {\n\t$0\n}` },
]

/** Parenthesises compound expressions so `!a || b` cannot happen by accident. */
function wrap(expr: string): string {
  return /^[\w$.\[\]()]+$/.test(expr) ? expr : `(${expr})`
}

const BY_LANGUAGE: Record<string, PostfixTemplate[]> = {
  typescript: TS,
  typescriptreact: TS,
  javascript: TS,
  javascriptreact: TS,
  python: PYTHON,
  go: GO,
  java: JAVA,
  kotlin: JAVA,
  csharp: JAVA,
  scala: JAVA,
  rust: RUST,
}

export function postfixTemplatesFor(language: string): PostfixTemplate[] {
  return BY_LANGUAGE[language] ?? []
}

export interface PostfixSite {
  /** The expression before the dot. */
  expression: string
  /** 1-based column where the expression starts. */
  startColumn: number
  /** What was typed after the dot, used as the filter prefix. */
  typed: string
}

/**
 * Reads `<expression>.<typed…>` backwards from the cursor.
 *
 * The scan walks left over identifier characters, `.` member chains and
 * balanced bracket groups, which covers `foo`, `a.b.c`, `items[i]`, `f(x)` and
 * combinations. It stops at operators and statement boundaries — wrapping
 * `a + b` is what parentheses in the template are for, not the scan.
 */
export function postfixSiteAt(line: string, column: number): PostfixSite | null {
  const before = line.slice(0, column - 1)
  const match = /\.([A-Za-z]*)$/.exec(before)
  if (!match) return null
  const typed = match[1]
  let i = before.length - typed.length - 2 // index of the char before the dot

  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  let end = i
  while (i >= 0) {
    const ch = before[i]
    if (closers[ch]) {
      // Skip the whole bracket group.
      let depth = 0
      while (i >= 0) {
        if (before[i] === closers[ch]) depth--
        else if (before[i] === ch) depth++
        if (depth === 0 && before[i] === closers[ch]) break
        i--
      }
      if (i < 0) return null
      i--
      continue
    }
    if (/[\w$]/.test(ch)) {
      i--
      continue
    }
    if (ch === '.') {
      i--
      continue
    }
    break
  }

  const start = i + 1
  const expression = before.slice(start, end + 1).trim()
  if (!expression) return null
  // A dot straight after a keyword is member access on nothing useful.
  if (/^(if|for|while|return|new|typeof|await|import|const|let|var)$/.test(expression)) return null
  return { expression, startColumn: start + 1, typed }
}
