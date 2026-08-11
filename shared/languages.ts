/**
 * Language detection shared by the renderer (Monaco) and the main process
 * (the symbol indexer), so both agree on what a file is.
 */

function baseName(p: string) {
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function extName(p: string) {
  const base = baseName(p)
  const idx = base.lastIndexOf('.')
  return idx <= 0 ? '' : base.slice(idx).toLowerCase()
}

/** Extension -> Monaco language id. Monaco ships a grammar for every entry. */
const BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.json5': 'json',
  '.html': 'html',
  '.htm': 'html',
  '.vue': 'html',
  '.svelte': 'html',
  '.hbs': 'handlebars',
  '.pug': 'pug',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.less': 'less',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.py': 'python',
  '.pyi': 'python',
  '.rb': 'ruby',
  '.gemspec': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.scala': 'scala',
  '.swift': 'swift',
  '.m': 'objective-c',
  '.mm': 'objective-c',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.hh': 'cpp',
  '.cs': 'csharp',
  '.fs': 'fsharp',
  '.fsx': 'fsharp',
  '.php': 'php',
  '.pl': 'perl',
  '.pm': 'perl',
  '.lua': 'lua',
  '.r': 'r',
  '.jl': 'julia',
  '.dart': 'dart',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.erl': 'erlang',
  '.hs': 'haskell',
  '.clj': 'clojure',
  '.cljs': 'clojure',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.fish': 'shell',
  '.ps1': 'powershell',
  '.bat': 'bat',
  '.cmd': 'bat',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.proto': 'proto',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.cfg': 'ini',
  '.conf': 'ini',
  '.env': 'ini',
  '.xml': 'xml',
  '.svg': 'xml',
  '.plist': 'xml',
  '.gradle': 'groovy',
  '.groovy': 'groovy',
  '.tf': 'hcl',
  '.tfvars': 'hcl',
  '.hcl': 'hcl',
  '.dockerfile': 'dockerfile',
  '.sol': 'sol',
  '.vb': 'vb',
  '.pas': 'pascal',
  '.asm': 'plaintext',
  '.s': 'plaintext',
  '.txt': 'plaintext',
  '.log': 'plaintext',
  '.csv': 'plaintext',
  '.mermaid': 'plaintext',
  '.mmd': 'plaintext',
  '.ipynb': 'json',
}

const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  rakefile: 'ruby',
  gemfile: 'ruby',
  brewfile: 'ruby',
  procfile: 'yaml',
  '.gitignore': 'plaintext',
  '.gitattributes': 'plaintext',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  'cmakelists.txt': 'plaintext',
}

export function languageForPath(path: string): string {
  const name = baseName(path).toLowerCase()
  if (BY_NAME[name]) return BY_NAME[name]
  if (name.startsWith('dockerfile')) return 'dockerfile'
  if (name.startsWith('.env')) return 'ini'
  return BY_EXT[extName(path)] ?? 'plaintext'
}

export function isMarkdown(path: string) {
  const ext = extName(path)
  return ext === '.md' || ext === '.markdown' || ext === '.mdx'
}

export function isImage(path: string) {
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg'].includes(extName(path))
}

export function isDiagramFile(path: string) {
  return path.endsWith('.nova-diagram.json')
}

/** Languages the symbol indexer knows how to parse declarations for. */
export const INDEXABLE_LANGUAGES = new Set([
  'typescript',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'scala',
  'groovy',
  'swift',
  'objective-c',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'dart',
  'elixir',
  'erlang',
  'haskell',
  'clojure',
  'lua',
  'r',
  'julia',
  'perl',
  'shell',
  'powershell',
  'sql',
  'graphql',
  'proto',
  'hcl',
  'css',
  'scss',
  'less',
  'html',
  'sol',
  'vb',
  'fsharp',
  'pascal',
])
