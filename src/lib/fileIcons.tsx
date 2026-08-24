import {
  Atom,
  Binary,
  BookOpen,
  Braces,
  Brackets,
  Bug,
  CircuitBoard,
  Cloud,
  Coffee,
  Cog,
  Component,
  Container,
  Database,
  Feather,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileJson,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Flame,
  Folder,
  FolderOpen,
  Gem,
  GitBranch,
  Globe,
  Hash,
  Image,
  Key,
  Layers,
  Lock,
  Package,
  Palette,
  Rocket,
  Ruler,
  Shapes,
  Shield,
  SlidersHorizontal,
  Sigma,
  Table,
  Terminal,
  TestTube,
  Type,
  Wind,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { basename, extname } from './paths'

export type IconPack = 'nova' | 'classic' | 'minimal'

interface IconSpec {
  Icon: LucideIcon
  color: string
}

/** Extension-keyed icon + accent colour used by the "nova" pack. */
/**
 * Extension-keyed icon and accent colour for the "nova" pack.
 *
 * Colours are each language's own — the blue TypeScript uses, Rust's rust — so
 * a tree is scannable by hue before any glyph is read. Where a family has no
 * colour of its own it borrows from its nearest relative rather than inventing
 * one, because a palette of fifty unrelated colours is noise.
 *
 * Glyphs are shared deliberately. There is no Lucide icon for Nim, and picking
 * an arbitrary one would say something untrue about the language; a generic
 * code glyph in Nim's yellow says exactly as much as is actually known.
 * Anything not listed here falls through to a plain file icon, which is the
 * honest answer for a file Nova has nothing to say about.
 */
const EXT_ICONS: Record<string, IconSpec> = {
  /* --- the web --- */
  '.ts': { Icon: FileCode, color: '#3178c6' },
  '.tsx': { Icon: Atom, color: '#3178c6' },
  '.mts': { Icon: FileCode, color: '#3178c6' },
  '.cts': { Icon: FileCode, color: '#3178c6' },
  '.js': { Icon: FileCode, color: '#f0db4f' },
  '.jsx': { Icon: Atom, color: '#61dafb' },
  '.mjs': { Icon: FileCode, color: '#f0db4f' },
  '.cjs': { Icon: FileCode, color: '#f0db4f' },
  '.vue': { Icon: Component, color: '#42b883' },
  '.svelte': { Icon: Flame, color: '#ff3e00' },
  '.astro': { Icon: Rocket, color: '#ff5d01' },
  '.html': { Icon: Globe, color: '#e34c26' },
  '.htm': { Icon: Globe, color: '#e34c26' },
  '.ejs': { Icon: Globe, color: '#a91e50' },
  '.hbs': { Icon: Globe, color: '#f0772b' },
  '.pug': { Icon: Globe, color: '#a86454' },
  '.css': { Icon: Palette, color: '#2965f1' },
  '.scss': { Icon: Palette, color: '#cd6799' },
  '.sass': { Icon: Palette, color: '#cd6799' },
  '.less': { Icon: Palette, color: '#1d365d' },
  '.styl': { Icon: Palette, color: '#ff6347' },

  /* --- systems --- */
  '.rs': { Icon: Cog, color: '#dea584' },
  '.c': { Icon: FileCode, color: '#a8b9cc' },
  '.h': { Icon: FileCode, color: '#a8b9cc' },
  '.cpp': { Icon: FileCode, color: '#00599c' },
  '.cc': { Icon: FileCode, color: '#00599c' },
  '.cxx': { Icon: FileCode, color: '#00599c' },
  '.hpp': { Icon: FileCode, color: '#00599c' },
  '.hh': { Icon: FileCode, color: '#00599c' },
  '.zig': { Icon: Zap, color: '#f7a41d' },
  '.nim': { Icon: FileCode, color: '#ffe953' },
  '.v': { Icon: FileCode, color: '#5d87bf' },
  '.d': { Icon: FileCode, color: '#b03931' },
  '.asm': { Icon: CircuitBoard, color: '#6e4c13' },
  '.s': { Icon: CircuitBoard, color: '#6e4c13' },
  '.wasm': { Icon: Binary, color: '#654ff0' },

  /* --- managed and scripting --- */
  '.py': { Icon: FileCode, color: '#3572a5' },
  '.pyi': { Icon: FileCode, color: '#3572a5' },
  '.pyw': { Icon: FileCode, color: '#3572a5' },
  '.ipynb': { Icon: BookOpen, color: '#f37626' },
  '.rb': { Icon: Gem, color: '#cc342d' },
  '.erb': { Icon: Gem, color: '#cc342d' },
  '.go': { Icon: FileCode, color: '#00add8' },
  '.java': { Icon: Coffee, color: '#e76f00' },
  '.kt': { Icon: FileCode, color: '#a97bff' },
  '.kts': { Icon: FileCode, color: '#a97bff' },
  '.scala': { Icon: FileCode, color: '#dc322f' },
  '.groovy': { Icon: FileCode, color: '#4298b8' },
  '.gradle': { Icon: Wrench, color: '#02303a' },
  '.cs': { Icon: FileCode, color: '#68217a' },
  '.fs': { Icon: FileCode, color: '#378bba' },
  '.fsx': { Icon: FileCode, color: '#378bba' },
  '.vb': { Icon: FileCode, color: '#945db7' },
  '.php': { Icon: FileCode, color: '#777bb4' },
  '.swift': { Icon: Rocket, color: '#f05138' },
  '.m': { Icon: FileCode, color: '#438eff' },
  '.mm': { Icon: FileCode, color: '#438eff' },
  '.dart': { Icon: FileCode, color: '#0175c2' },
  '.lua': { Icon: FileCode, color: '#000080' },
  '.pl': { Icon: FileCode, color: '#0298c3' },
  '.pm': { Icon: FileCode, color: '#0298c3' },
  '.r': { Icon: Sigma, color: '#276dc3' },
  '.jl': { Icon: Sigma, color: '#9558b2' },
  '.f90': { Icon: Sigma, color: '#734f96' },
  '.pas': { Icon: FileCode, color: '#e3f171' },
  '.cob': { Icon: FileCode, color: '#005ca5' },

  /* --- functional --- */
  '.hs': { Icon: Sigma, color: '#5e5086' },
  '.ex': { Icon: Feather, color: '#6e4a7e' },
  '.exs': { Icon: Feather, color: '#6e4a7e' },
  '.erl': { Icon: Feather, color: '#b83998' },
  '.clj': { Icon: Braces, color: '#5881d8' },
  '.cljs': { Icon: Braces, color: '#5881d8' },
  '.el': { Icon: Braces, color: '#7f5ab6' },
  '.lisp': { Icon: Braces, color: '#3fb68b' },
  '.ml': { Icon: Sigma, color: '#ec6813' },
  '.elm': { Icon: Shapes, color: '#60b5cc' },

  /* --- contracts --- */
  '.sol': { Icon: Shield, color: '#627eea' },
  '.move': { Icon: Shield, color: '#4a90d9' },
  '.cairo': { Icon: Shield, color: '#ff4a57' },

  /* --- shells --- */
  '.sh': { Icon: Terminal, color: '#89e051' },
  '.bash': { Icon: Terminal, color: '#89e051' },
  '.zsh': { Icon: Terminal, color: '#89e051' },
  '.fish': { Icon: Terminal, color: '#4aae47' },
  '.ps1': { Icon: Terminal, color: '#012456' },
  '.bat': { Icon: Terminal, color: '#c1f12e' },
  '.cmd': { Icon: Terminal, color: '#c1f12e' },
  '.vim': { Icon: FileCode, color: '#019833' },

  /* --- data and schemas --- */
  '.json': { Icon: FileJson, color: '#f0db4f' },
  '.jsonc': { Icon: FileJson, color: '#f0db4f' },
  '.json5': { Icon: FileJson, color: '#f0db4f' },
  '.yaml': { Icon: Layers, color: '#cb171e' },
  '.yml': { Icon: Layers, color: '#cb171e' },
  '.toml': { Icon: Cog, color: '#9c4221' },
  '.ini': { Icon: SlidersHorizontal, color: '#8fa3b8' },
  '.conf': { Icon: SlidersHorizontal, color: '#8fa3b8' },
  '.cfg': { Icon: SlidersHorizontal, color: '#8fa3b8' },
  '.properties': { Icon: SlidersHorizontal, color: '#8fa3b8' },
  '.plist': { Icon: SlidersHorizontal, color: '#8fa3b8' },
  '.xml': { Icon: FileType, color: '#f1662a' },
  '.csv': { Icon: Table, color: '#1d6f42' },
  '.tsv': { Icon: Table, color: '#1d6f42' },
  '.parquet': { Icon: Table, color: '#50abdc' },
  '.avro': { Icon: Table, color: '#50abdc' },
  '.sql': { Icon: Database, color: '#e38c00' },
  '.db': { Icon: Database, color: '#8fa3b8' },
  '.sqlite': { Icon: Database, color: '#003b57' },
  '.sqlite3': { Icon: Database, color: '#003b57' },
  '.graphql': { Icon: Workflow, color: '#e535ab' },
  '.gql': { Icon: Workflow, color: '#e535ab' },
  '.proto': { Icon: Workflow, color: '#4285f4' },
  '.thrift': { Icon: Workflow, color: '#a0a0a0' },
  '.prisma': { Icon: Database, color: '#5a67d8' },

  /* --- infrastructure --- */
  '.tf': { Icon: Cloud, color: '#7b42bc' },
  '.tfvars': { Icon: Cloud, color: '#7b42bc' },
  '.hcl': { Icon: Cloud, color: '#7b42bc' },

  /* --- prose --- */
  '.md': { Icon: FileText, color: '#8fa3b8' },
  '.mdx': { Icon: FileText, color: '#8fa3b8' },
  '.rst': { Icon: FileText, color: '#8fa3b8' },
  '.adoc': { Icon: FileText, color: '#8fa3b8' },
  '.txt': { Icon: FileText, color: '#8fa3b8' },
  '.rtf': { Icon: FileText, color: '#8fa3b8' },
  '.pdf': { Icon: FileText, color: '#e5252a' },
  '.doc': { Icon: FileText, color: '#2b579a' },
  '.docx': { Icon: FileText, color: '#2b579a' },
  '.xls': { Icon: FileSpreadsheet, color: '#1d6f42' },
  '.xlsx': { Icon: FileSpreadsheet, color: '#1d6f42' },
  '.ppt': { Icon: FileType, color: '#d24726' },
  '.pptx': { Icon: FileType, color: '#d24726' },
  '.log': { Icon: FileText, color: '#8fa3b8' },
  '.patch': { Icon: GitBranch, color: '#f05033' },
  '.diff': { Icon: GitBranch, color: '#f05033' },

  /* --- media --- */
  '.svg': { Icon: Shapes, color: '#ffb13b' },
  '.png': { Icon: Image, color: '#a074c4' },
  '.jpg': { Icon: Image, color: '#a074c4' },
  '.jpeg': { Icon: Image, color: '#a074c4' },
  '.gif': { Icon: FileImage, color: '#a074c4' },
  '.webp': { Icon: FileImage, color: '#a074c4' },
  '.avif': { Icon: FileImage, color: '#a074c4' },
  '.bmp': { Icon: FileImage, color: '#a074c4' },
  '.ico': { Icon: FileImage, color: '#a074c4' },
  '.mp4': { Icon: FileVideo, color: '#e8a33d' },
  '.mov': { Icon: FileVideo, color: '#e8a33d' },
  '.webm': { Icon: FileVideo, color: '#e8a33d' },
  '.avi': { Icon: FileVideo, color: '#e8a33d' },
  '.mkv': { Icon: FileVideo, color: '#e8a33d' },
  '.mp3': { Icon: FileAudio, color: '#e8a33d' },
  '.wav': { Icon: FileAudio, color: '#e8a33d' },
  '.flac': { Icon: FileAudio, color: '#e8a33d' },
  '.ogg': { Icon: FileAudio, color: '#e8a33d' },
  '.ttf': { Icon: Type, color: '#c678dd' },
  '.otf': { Icon: Type, color: '#c678dd' },
  '.woff': { Icon: Type, color: '#c678dd' },
  '.woff2': { Icon: Type, color: '#c678dd' },

  /* --- archives and binaries --- */
  '.zip': { Icon: FileArchive, color: '#c4a000' },
  '.tar': { Icon: FileArchive, color: '#c4a000' },
  '.gz': { Icon: FileArchive, color: '#c4a000' },
  '.tgz': { Icon: FileArchive, color: '#c4a000' },
  '.bz2': { Icon: FileArchive, color: '#c4a000' },
  '.xz': { Icon: FileArchive, color: '#c4a000' },
  '.7z': { Icon: FileArchive, color: '#c4a000' },
  '.rar': { Icon: FileArchive, color: '#c4a000' },
  '.jar': { Icon: FileArchive, color: '#e76f00' },
  '.exe': { Icon: Binary, color: '#8fa3b8' },
  '.dll': { Icon: Binary, color: '#8fa3b8' },
  '.so': { Icon: Binary, color: '#8fa3b8' },
  '.dylib': { Icon: Binary, color: '#8fa3b8' },
  '.o': { Icon: Binary, color: '#8fa3b8' },
  '.apk': { Icon: Package, color: '#3ddc84' },
  '.ipa': { Icon: Package, color: '#8fa3b8' },
  '.dmg': { Icon: Package, color: '#8fa3b8' },
  '.deb': { Icon: Package, color: '#a80030' },
  '.rpm': { Icon: Package, color: '#a80030' },

  /* --- credentials, which are worth spotting at a glance --- */
  '.env': { Icon: Lock, color: '#ecd53f' },
  '.pem': { Icon: Key, color: '#e5252a' },
  '.crt': { Icon: Key, color: '#e5252a' },
  '.cert': { Icon: Key, color: '#e5252a' },
  '.cer': { Icon: Key, color: '#e5252a' },
  '.p12': { Icon: Key, color: '#e5252a' },
  '.pfx': { Icon: Key, color: '#e5252a' },
  '.keystore': { Icon: Key, color: '#e5252a' },
  '.lock': { Icon: Lock, color: '#8fa3b8' },

  /* --- Nova's own --- */
  '.http': { Icon: Zap, color: '#6ea8fe' },
  '.rest': { Icon: Zap, color: '#6ea8fe' },
  '.nova-diagram.json': { Icon: Shapes, color: '#6ea8fe' },
}

/**
 * Whole-filename matches, which win over the extension.
 *
 * A `Dockerfile` has no extension and `Cargo.toml` is not just any TOML — the
 * name is the more specific fact, so it is checked first. Manifests get their
 * ecosystem's colour, lockfiles get a padlock: the pair is worth telling apart
 * at a glance, because one is edited by hand and the other never is.
 */
const NAME_ICONS: Record<string, IconSpec> = {
  /* manifests */
  'package.json': { Icon: Package, color: '#cb3837' },
  'cargo.toml': { Icon: Package, color: '#dea584' },
  'go.mod': { Icon: Package, color: '#00add8' },
  'pyproject.toml': { Icon: Package, color: '#3572a5' },
  'requirements.txt': { Icon: Package, color: '#3572a5' },
  'pipfile': { Icon: Package, color: '#3572a5' },
  'gemfile': { Icon: Gem, color: '#cc342d' },
  'pom.xml': { Icon: Package, color: '#e76f00' },
  'build.gradle': { Icon: Wrench, color: '#02303a' },
  'build.gradle.kts': { Icon: Wrench, color: '#02303a' },
  'composer.json': { Icon: Package, color: '#777bb4' },
  'pubspec.yaml': { Icon: Package, color: '#0175c2' },
  'mix.exs': { Icon: Feather, color: '#6e4a7e' },
  'cmakelists.txt': { Icon: Wrench, color: '#064f8c' },
  'makefile': { Icon: Wrench, color: '#6d8086' },
  'justfile': { Icon: Wrench, color: '#6d8086' },
  'rakefile': { Icon: Wrench, color: '#cc342d' },

  /* lockfiles — never hand-edited, so visually distinct from the manifest */
  'package-lock.json': { Icon: Lock, color: '#cb3837' },
  'pnpm-lock.yaml': { Icon: Lock, color: '#f69220' },
  'yarn.lock': { Icon: Lock, color: '#2c8ebb' },
  'bun.lockb': { Icon: Lock, color: '#fbf0df' },
  'cargo.lock': { Icon: Lock, color: '#dea584' },
  'go.sum': { Icon: Lock, color: '#00add8' },
  'poetry.lock': { Icon: Lock, color: '#3572a5' },
  'gemfile.lock': { Icon: Lock, color: '#cc342d' },
  'composer.lock': { Icon: Lock, color: '#777bb4' },
  'pubspec.lock': { Icon: Lock, color: '#0175c2' },

  /* containers and deployment */
  dockerfile: { Icon: Container, color: '#2496ed' },
  'docker-compose.yml': { Icon: Container, color: '#2496ed' },
  'docker-compose.yaml': { Icon: Container, color: '#2496ed' },
  '.dockerignore': { Icon: Container, color: '#2496ed' },
  procfile: { Icon: Cloud, color: '#79589f' },
  'vercel.json': { Icon: Cloud, color: '#8fa3b8' },
  'netlify.toml': { Icon: Cloud, color: '#00c7b7' },

  /* git */
  '.gitignore': { Icon: GitBranch, color: '#f05033' },
  '.gitattributes': { Icon: GitBranch, color: '#f05033' },
  '.gitmodules': { Icon: GitBranch, color: '#f05033' },
  '.gitkeep': { Icon: GitBranch, color: '#f05033' },

  /* tooling config */
  'tsconfig.json': { Icon: Cog, color: '#3178c6' },
  'jsconfig.json': { Icon: Cog, color: '#f0db4f' },
  '.eslintrc': { Icon: Bug, color: '#4b32c3' },
  '.eslintrc.json': { Icon: Bug, color: '#4b32c3' },
  '.eslintrc.js': { Icon: Bug, color: '#4b32c3' },
  'eslint.config.js': { Icon: Bug, color: '#4b32c3' },
  '.prettierrc': { Icon: Ruler, color: '#f7b93e' },
  '.prettierrc.json': { Icon: Ruler, color: '#f7b93e' },
  '.editorconfig': { Icon: Ruler, color: '#8fa3b8' },
  '.babelrc': { Icon: Cog, color: '#f9dc3e' },
  '.nvmrc': { Icon: Cog, color: '#5fa04e' },
  '.npmrc': { Icon: Lock, color: '#cb3837' },
  'vite.config.ts': { Icon: Rocket, color: '#a259ff' },
  'vite.config.js': { Icon: Rocket, color: '#a259ff' },
  'webpack.config.js': { Icon: Package, color: '#8dd6f9' },
  'rollup.config.js': { Icon: Package, color: '#ef3335' },
  'tailwind.config.js': { Icon: Wind, color: '#38bdf8' },
  'tailwind.config.ts': { Icon: Wind, color: '#38bdf8' },
  'next.config.js': { Icon: Rocket, color: '#8fa3b8' },
  'nuxt.config.ts': { Icon: Rocket, color: '#00dc82' },
  'svelte.config.js': { Icon: Flame, color: '#ff3e00' },
  'astro.config.mjs': { Icon: Rocket, color: '#ff5d01' },
  'jest.config.js': { Icon: TestTube, color: '#c21325' },
  'vitest.config.ts': { Icon: TestTube, color: '#729b1b' },
  'playwright.config.ts': { Icon: TestTube, color: '#2ead33' },

  /* the documents every repository has */
  'readme.md': { Icon: FileText, color: '#6ea8fe' },
  'readme': { Icon: FileText, color: '#6ea8fe' },
  'changelog.md': { Icon: FileText, color: '#8bc34a' },
  'contributing.md': { Icon: FileText, color: '#8fa3b8' },
  'license': { Icon: FileText, color: '#d4b106' },
  'license.md': { Icon: FileText, color: '#d4b106' },
  'notice': { Icon: FileText, color: '#d4b106' },
  'codeowners': { Icon: Shield, color: '#8fa3b8' },
}

/**
 * The icon for a path, most specific match first.
 *
 * The order matters. A whole filename beats a compound suffix, which beats a
 * plain extension — `Cargo.toml` is not just any TOML, and `client.d.ts` is a
 * declaration rather than TypeScript source. Anything unmatched gets a plain
 * file icon, which is the right answer for a file Nova genuinely knows nothing
 * about: guessing from a three-letter extension it has never seen would be
 * confidently wrong rather than quietly neutral.
 */
export function fileIcon(path: string, pack: IconPack = 'nova'): IconSpec {
  const name = basename(path).toLowerCase()
  if (pack === 'minimal') return { Icon: FileIcon, color: 'var(--text-faint)' }

  const shade = (spec: IconSpec): IconSpec =>
    pack === 'classic' ? { Icon: spec.Icon, color: 'var(--text-muted)' } : spec

  if (name.endsWith('.nova-diagram.json')) return shade(EXT_ICONS['.nova-diagram.json'])
  if (NAME_ICONS[name]) return shade(NAME_ICONS[name])

  // `.env.local`, `.env.production` and friends are all credentials, and the
  // suffix is the environment rather than a file type.
  if (name === '.env' || name.startsWith('.env.')) return shade(EXT_ICONS['.env'])

  // Tests earn their own glyph across every language that spells them this way.
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name) || /_test\.(go|py|rb)$/.test(name)) {
    return shade({ Icon: TestTube, color: '#8bc34a' })
  }

  // A declaration file describes an interface rather than implementing one.
  if (name.endsWith('.d.ts') || name.endsWith('.d.mts')) {
    return shade({ Icon: Brackets, color: '#3178c6' })
  }

  const ext = extname(path)
  if (EXT_ICONS[ext]) return shade(EXT_ICONS[ext])

  // A compressed archive keeps the archive glyph rather than taking one from
  // whatever it happens to wrap: `.tar.gz`, `.tar.bz2`.
  if (/\.tar\.(gz|bz2|xz|zst)$/.test(name)) return shade(EXT_ICONS['.tar'])

  // A dotfile with no extension at all is almost always shell or tool
  // configuration — `.bashrc`, `.zshrc`, `.vimrc`, `.profile`.
  if (name.startsWith('.') && !ext) return shade({ Icon: SlidersHorizontal, color: '#8fa3b8' })

  return shade({ Icon: FileIcon, color: '#8fa3b8' })
}

export function folderIcon(open: boolean, pack: IconPack = 'nova'): IconSpec {
  const Icon = open ? FolderOpen : Folder
  if (pack === 'minimal') return { Icon, color: 'var(--text-faint)' }
  if (pack === 'classic') return { Icon, color: 'var(--text-muted)' }
  return { Icon, color: '#7aa2f7' }
}

/** The icon set offered to diagram nodes. */
export const diagramIconChoices = [
  'box',
  'server',
  'database',
  'cloud',
  'globe',
  'user',
  'users',
  'shield',
  'lock',
  'key',
  'cpu',
  'hard-drive',
  'layers',
  'package',
  'terminal',
  'code',
  'git-branch',
  'workflow',
  'zap',
  'activity',
  'bell',
  'mail',
  'message-square',
  'smartphone',
  'monitor',
  'router',
  'network',
  'container',
  'boxes',
  'file-text',
  'folder',
  'search',
  'settings',
  'timer',
  'refresh-cw',
  'send',
  'inbox',
  'credit-card',
  'shopping-cart',
  'bar-chart',
  'pie-chart',
  'brain',
  'bot',
  'flame',
  'star',
  'heart',
  'flag',
  'map-pin',
  'link',
  'plug',
] as const

export type DiagramIconName = (typeof diagramIconChoices)[number]

export { Hash, Braces }
