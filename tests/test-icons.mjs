/**
 * The file-icon resolver.
 *
 * Pure logic over a filename, so it is tested directly rather than by looking
 * at a tree. What is being checked is the precedence — a whole filename beats a
 * compound suffix beats an extension — and that an unknown extension lands on a
 * plain file icon rather than borrowing something confidently wrong.
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { BUILD } from './env.mjs'

const { fileIcon, folderIcon } = await import(
  pathToFileURL(path.join(BUILD, 'fileIcons.js')).href
)

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

/** The icon's display name, which is what distinguishes one glyph from another. */
const glyph = (p) => {
  const { Icon } = fileIcon(p)
  return Icon.displayName ?? Icon.name ?? String(Icon)
}
const colour = (p) => fileIcon(p).color

console.log('\n-- languages get their own colour --')

for (const [file, hue, label] of [
  ['a.ts', '#3178c6', 'TypeScript blue'],
  ['a.rs', '#dea584', 'Rust'],
  ['a.py', '#3572a5', 'Python'],
  ['a.go', '#00add8', 'Go'],
  ['a.rb', '#cc342d', 'Ruby'],
  ['a.java', '#e76f00', 'Java'],
  ['a.php', '#777bb4', 'PHP'],
  ['a.swift', '#f05138', 'Swift'],
  ['a.svelte', '#ff3e00', 'Svelte'],
  ['a.vue', '#42b883', 'Vue'],
]) {
  check(`${file} is ${label}`, colour(file) === hue, colour(file))
}

console.log('\n-- an unknown extension is not guessed at --')

for (const file of ['a.qqq', 'a.zzz', 'weird.xyz', 'noextension']) {
  check(`${file} falls back to a plain file icon`, glyph(file) === 'File', glyph(file))
}

console.log('\n-- precedence --')

check('a known filename beats its extension',
  glyph('Cargo.toml') !== glyph('other.toml'), `${glyph('Cargo.toml')} vs ${glyph('other.toml')}`)
check('a lockfile is distinguished from its manifest',
  glyph('package-lock.json') !== glyph('package.json'),
  `${glyph('package-lock.json')} vs ${glyph('package.json')}`)
check('a declaration file is distinguished from source',
  glyph('client.d.ts') !== glyph('client.ts'), `${glyph('client.d.ts')} vs ${glyph('client.ts')}`)
check('a test file gets the test glyph', glyph('a.test.ts') === 'TestTube', glyph('a.test.ts'))
check('so does a Go test', glyph('handler_test.go') === 'TestTube', glyph('handler_test.go'))
check('so does a Python test', glyph('thing_test.py') === 'TestTube', glyph('thing_test.py'))
check('but ordinary source does not', glyph('a.ts') !== 'TestTube', glyph('a.ts'))

console.log('\n-- credentials are visible at a glance --')

check('.env is a padlock', glyph('.env') === 'Lock', glyph('.env'))
check('so is .env.production', glyph('.env.production') === 'Lock', glyph('.env.production'))
check('so is .env.local', glyph('.env.local') === 'Lock', glyph('.env.local'))
check('a certificate is a key', glyph('server.pem') === 'Key', glyph('server.pem'))
check('and so is a keystore', glyph('debug.keystore') === 'Key', glyph('debug.keystore'))

console.log('\n-- names without extensions --')

check('Dockerfile is a container', glyph('Dockerfile') === 'Container', glyph('Dockerfile'))
check('and is matched whatever the case', glyph('DOCKERFILE') === 'Container', glyph('DOCKERFILE'))
check('Makefile is a tool', glyph('Makefile') === 'Wrench', glyph('Makefile'))
check('a bare dotfile is treated as configuration',
  glyph('.zshrc') === 'SlidersHorizontal', glyph('.zshrc'))
// Rust's logo is a gear, so it keeps that glyph — which means configuration
// must not also use it, or a tree with both is unreadable.
check('and does not share a glyph with Rust',
  glyph('.zshrc') !== glyph('main.rs'), `${glyph('.zshrc')} vs ${glyph('main.rs')}`)
check('a compressed tarball stays an archive',
  glyph('bundle.tar.gz') === 'FileArchive', glyph('bundle.tar.gz'))

console.log('\n-- the packs --')

check('minimal flattens everything to one glyph',
  fileIcon('a.rs', 'minimal').Icon.displayName === 'File' &&
  fileIcon('package.json', 'minimal').Icon.displayName === 'File')
check('classic keeps the glyph but drops the colour',
  fileIcon('a.rs', 'classic').Icon === fileIcon('a.rs', 'nova').Icon &&
  fileIcon('a.rs', 'classic').color.startsWith('var('),
  fileIcon('a.rs', 'classic').color)
check('classic drops the colour for named files too',
  fileIcon('package.json', 'classic').color.startsWith('var('),
  fileIcon('package.json', 'classic').color)
check('classic drops the colour for tests too',
  fileIcon('a.test.ts', 'classic').color.startsWith('var('),
  fileIcon('a.test.ts', 'classic').color)
check('folders follow the pack',
  folderIcon(false, 'minimal').color.startsWith('var(') &&
  folderIcon(true, 'nova').Icon.displayName === 'FolderOpen')

console.log('\n-- coverage --')

const LANGS = [
  '.ts','.tsx','.js','.jsx','.vue','.svelte','.astro','.html','.css','.scss','.rs','.c','.cpp',
  '.zig','.nim','.py','.ipynb','.rb','.go','.java','.kt','.scala','.cs','.fs','.php','.swift',
  '.dart','.lua','.pl','.r','.jl','.hs','.ex','.erl','.clj','.elm','.sol','.sh','.ps1','.json',
  '.yaml','.toml','.xml','.csv','.sql','.graphql','.proto','.tf','.md','.svg','.png','.mp4',
  '.mp3','.ttf','.zip','.env','.pem','.http',
]
const uncovered = LANGS.filter((ext) => glyph(`a${ext}`) === 'File')
check(`${LANGS.length} common types all resolve to something specific`,
  uncovered.length === 0, uncovered.join(' '))

const distinct = new Set(LANGS.map((ext) => `${glyph(`a${ext}`)}|${colour(`a${ext}`)}`))
check('and they are not all the same icon', distinct.size >= 30, `${distinct.size} distinct`)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
