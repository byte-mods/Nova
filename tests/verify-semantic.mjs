/**
 * Checks semantic highlighting in the running IDE, across languages.
 *
 * The bug this guards against is invisible to a unit test: Monaco's grammars
 * report every name as `identifier`, so a function call and the variable next
 * to it render in exactly the same colour. The only honest check is to read
 * the colour the browser actually computed for each word.
 *
 * Start the app first:  bash tests/restart-app.sh
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { connect } from './cdp.mjs'
import { TMP } from './env.mjs'

const PROJECT = path.join(TMP, 'semantic-demo')

/**
 * One file per language, each with the same three things: a function
 * declaration, a call, a type name, and a plain variable that must stay the
 * ordinary text colour.
 */
const FIXTURES = [
  { file: 'orders.py', language: 'python', source: `subtotal = 10\n\n\nclass OrderService:\n    def computeTotal(self, items):\n        return computeTotal(subtotal)\n` },
  { file: 'orders.go', language: 'go', source: `package main\n\ntype OrderService struct{}\n\nfunc computeTotal(items int) int {\n\tsubtotal := items\n\treturn computeTotal(subtotal)\n}\n` },
  { file: 'orders.rs', language: 'rust', source: `struct OrderService;\n\nfn computeTotal(items: i32) -> i32 {\n    let subtotal = items;\n    computeTotal(subtotal)\n}\n` },
  { file: 'Orders.java', language: 'java', source: `class OrderService {\n    int computeTotal(int items) {\n        int subtotal = items;\n        return computeTotal(subtotal);\n    }\n}\n` },
  { file: 'orders.rb', language: 'ruby', source: `class OrderService\n  def computeTotal(items)\n    subtotal = items\n    computeTotal(subtotal)\n  end\nend\n` },
  { file: 'orders.lua', language: 'lua', type: null, source: `local subtotal = 10\n\nfunction computeTotal(items)\n  return computeTotal(subtotal)\nend\n` },
  // PHP sigils are part of the token, so the whole `$subtotal` is one span.
  { file: 'orders.php', language: 'php', plain: '$subtotal', source: `<?php\nclass OrderService {\n  function computeTotal($items) {\n    $subtotal = $items;\n    return computeTotal($subtotal);\n  }\n}\n` },
  { file: 'Orders.kt', language: 'kotlin', source: `class OrderService {\n    fun computeTotal(items: Int): Int {\n        val subtotal = items\n        return computeTotal(subtotal)\n    }\n}\n` },
  { file: 'Orders.swift', language: 'swift', source: `class OrderService {\n    func computeTotal(items: Int) -> Int {\n        let subtotal = items\n        return computeTotal(subtotal)\n    }\n}\n` },
  { file: 'orders.c', language: 'c', source: `struct OrderService { int n; };\n\nint computeTotal(int items) {\n    int subtotal = items;\n    return computeTotal(subtotal);\n}\n` },
  { file: 'orders.dart', language: 'dart', source: `class OrderService {\n  int computeTotal(int items) {\n    var subtotal = items;\n    return computeTotal(subtotal);\n  }\n}\n` },
  { file: 'orders.ts', language: 'typescript', source: `class OrderService {\n  computeTotal(items: number): number {\n    const subtotal = items\n    return this.computeTotal(subtotal)\n  }\n}\n` },
]

async function buildFixture() {
  await fs.rm(PROJECT, { recursive: true, force: true })
  await fs.mkdir(PROJECT, { recursive: true })
  for (const { file, source } of FIXTURES) {
    await fs.writeFile(path.join(PROJECT, file), source)
  }
}

const cdp = await connect()
await buildFixture()

await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.setState({ sidebarVisible: true, sidebarView: 'explorer' })
  await s.getState().openProject(${JSON.stringify(PROJECT)})
  return true
`)
await cdp.waitFor(`document.querySelectorAll('.tree-row').length > 0`, { label: 'file tree' })

/** The theme's own function and type colours, to compare rendered text against. */
const palette = await cdp.evaluate(`
  const { themes } = await import('/src/theme/themes.ts')
  const s = (await import('/src/state/store.ts')).useStore
  const theme = themes.find(t => t.id === s.getState().settings.themeId) ?? themes[0]
  const toRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    return \`rgb(\${(n >> 16) & 255}, \${(n >> 8) & 255}, \${n & 255})\`
  }
  return { name: theme.name, func: toRgb(theme.syntax.func), type: toRgb(theme.syntax.type) }
`)

console.log(`theme: ${palette.name}  function=${palette.func}  type=${palette.type}\n`)

let pass = 0
let fail = 0

for (const fixture of FIXTURES) {
  const { file, language } = fixture
  const typeName = fixture.type === null ? null : 'OrderService'
  const plainName = fixture.plain ?? 'subtotal'

  await cdp.evaluate(`
    const s = (await import('/src/state/store.ts')).useStore
    await s.getState().openFile(${JSON.stringify(path.join(PROJECT, file))})
    return true
  `)
  await cdp.waitFor(`document.querySelectorAll('.view-line').length > 0`, { label: `${file} lines` })
  // Semantic tokens are computed a frame or two after the first paint.
  await cdp.sleep(1200)

  const colours = await cdp.evaluate(`
    const spans = [...document.querySelectorAll('.view-line span span')]
    const colourOf = (word) => {
      if (!word) return null
      const hit = spans.find(s => (s.textContent || '').trim() === word)
      return hit ? getComputedStyle(hit).color : null
    }
    return {
      fn: colourOf('computeTotal'),
      type: colourOf(${JSON.stringify(typeName)}),
      plain: colourOf(${JSON.stringify(plainName)}),
      spans: spans.length,
    }
  `)

  const fnOk = colours.fn === palette.func
  const typeOk = typeName === null || colours.type === palette.type
  // The point of the whole exercise: an ordinary variable must NOT come out
  // the same colour as the function beside it.
  const plainOk = colours.plain !== null && colours.plain !== palette.func

  if (fnOk && typeOk && plainOk) {
    pass++
    console.log(`  PASS  ${language.padEnd(11)} function ${colours.fn}  type ${colours.type ?? '—'}`)
  } else {
    fail++
    console.log(
      `  FAIL  ${language.padEnd(11)} function=${colours.fn} (want ${palette.func})` +
        ` type=${colours.type} (want ${typeName ? palette.type : 'n/a'})` +
        ` plain=${colours.plain} spans=${colours.spans}`,
    )
  }
}

/* ------------------------------------------------------------------ */
/* the language-server path                                            */
/* ------------------------------------------------------------------ */

/**
 * Everything above passes on the syntactic fallback alone, so it would keep
 * passing if the client capability were dropped and servers stopped sending
 * tokens entirely. This asks a server that supports them for real ones.
 *
 * The path has to come from the model rather than being rebuilt here: the
 * store resolves symlinks when it opens a file, and a server tracks the
 * document under the path it was opened with.
 */
const withSupport = await cdp.evaluate(`
  const out = []
  for (const lang of ['rust', 'c', 'go', 'python', 'typescript']) {
    const c = await window.nova.lsp.capabilities(lang).catch(() => null)
    if (c && c.capabilities.semanticTokensProvider) out.push([lang, c.id])
  }
  return out
`)

if (withSupport.length === 0) {
  console.log('\n  SKIP  no installed language server advertises semantic tokens')
} else {
  for (const [language, serverId] of withSupport) {
    const fixture = FIXTURES.find((f) => f.language === language)
    if (!fixture) continue

    await cdp.evaluate(`
      const s = (await import('/src/state/store.ts')).useStore
      await s.getState().openFile(${JSON.stringify(path.join(PROJECT, fixture.file))})
      return true
    `)
    await cdp.sleep(3000)

    const served = await cdp.evaluate(`
      const { monaco } = await import('/src/lib/monacoSetup.ts')
      const { remapServerTokens } = await import('/src/lib/semanticClassify.ts')
      const { SEMANTIC_TOKEN_TYPES } = await import('/shared/semantic.ts')
      const model = monaco.editor.getModels().find(m => m.getLanguageId() === ${JSON.stringify(language)})
      if (!model) return { error: 'no model' }
      const raw = await window.nova.lsp.semanticTokens(model.uri.fsPath || model.uri.path, ${JSON.stringify(language)})
      if (!raw) return { error: 'no tokens' }
      const mapped = remapServerTokens(raw.data, raw.legend)
      const kinds = new Set()
      for (let i = 3; i < mapped.length; i += 5) kinds.add(SEMANTIC_TOKEN_TYPES[mapped[i]])
      return { groups: mapped.length / 5, kinds: [...kinds] }
    `)

    // A server that resolved the file reports more than one kind of thing —
    // at minimum the function and something that is not a function.
    if (served.groups > 0 && served.kinds.length > 1) {
      pass++
      console.log(`  PASS  ${language.padEnd(11)} ${serverId} sent ${served.groups} tokens: ${served.kinds.join(', ')}`)
    } else {
      fail++
      console.log(`  FAIL  ${language.padEnd(11)} ${serverId} — ${JSON.stringify(served)}`)
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
await cdp.close()
process.exit(fail ? 1 : 0)
