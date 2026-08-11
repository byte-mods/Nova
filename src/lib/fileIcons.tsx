import {
  Binary,
  Braces,
  Coffee,
  Cog,
  Container,
  Database,
  File as FileIcon,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileType,
  Folder,
  FolderOpen,
  GitBranch,
  Globe,
  Hash,
  Image,
  Layers,
  Lock,
  Package,
  Palette,
  Rocket,
  Shapes,
  Sigma,
  Terminal,
  TestTube,
  Workflow,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { basename, extname } from './paths'

export type IconPack = 'nova' | 'classic' | 'minimal'

interface IconSpec {
  Icon: LucideIcon
  color: string
}

/** Extension-keyed icon + accent colour used by the "nova" pack. */
const EXT_ICONS: Record<string, IconSpec> = {
  '.ts': { Icon: FileCode, color: '#3178c6' },
  '.tsx': { Icon: FileCode, color: '#3178c6' },
  '.js': { Icon: FileCode, color: '#f0db4f' },
  '.jsx': { Icon: FileCode, color: '#61dafb' },
  '.mjs': { Icon: FileCode, color: '#f0db4f' },
  '.cjs': { Icon: FileCode, color: '#f0db4f' },
  '.json': { Icon: FileJson, color: '#f0db4f' },
  '.html': { Icon: Globe, color: '#e34c26' },
  '.css': { Icon: Palette, color: '#2965f1' },
  '.scss': { Icon: Palette, color: '#cd6799' },
  '.less': { Icon: Palette, color: '#1d365d' },
  '.md': { Icon: FileText, color: '#8fa3b8' },
  '.mdx': { Icon: FileText, color: '#8fa3b8' },
  '.py': { Icon: FileCode, color: '#3572a5' },
  '.rb': { Icon: FileCode, color: '#cc342d' },
  '.go': { Icon: FileCode, color: '#00add8' },
  '.rs': { Icon: Cog, color: '#dea584' },
  '.java': { Icon: Coffee, color: '#e76f00' },
  '.kt': { Icon: FileCode, color: '#a97bff' },
  '.swift': { Icon: Rocket, color: '#f05138' },
  '.c': { Icon: FileCode, color: '#a8b9cc' },
  '.h': { Icon: FileCode, color: '#a8b9cc' },
  '.cpp': { Icon: FileCode, color: '#00599c' },
  '.cs': { Icon: FileCode, color: '#68217a' },
  '.php': { Icon: FileCode, color: '#777bb4' },
  '.lua': { Icon: FileCode, color: '#000080' },
  '.dart': { Icon: FileCode, color: '#0175c2' },
  '.ex': { Icon: FileCode, color: '#6e4a7e' },
  '.sh': { Icon: Terminal, color: '#89e051' },
  '.bash': { Icon: Terminal, color: '#89e051' },
  '.zsh': { Icon: Terminal, color: '#89e051' },
  '.sql': { Icon: Database, color: '#e38c00' },
  '.graphql': { Icon: Workflow, color: '#e535ab' },
  '.proto': { Icon: Workflow, color: '#4285f4' },
  '.yaml': { Icon: Layers, color: '#cb171e' },
  '.yml': { Icon: Layers, color: '#cb171e' },
  '.toml': { Icon: Cog, color: '#9c4221' },
  '.ini': { Icon: Cog, color: '#8fa3b8' },
  '.env': { Icon: Lock, color: '#ecd53f' },
  '.xml': { Icon: FileType, color: '#f1662a' },
  '.svg': { Icon: Shapes, color: '#ffb13b' },
  '.png': { Icon: Image, color: '#a074c4' },
  '.jpg': { Icon: Image, color: '#a074c4' },
  '.jpeg': { Icon: Image, color: '#a074c4' },
  '.gif': { Icon: FileImage, color: '#a074c4' },
  '.webp': { Icon: FileImage, color: '#a074c4' },
  '.ico': { Icon: FileImage, color: '#a074c4' },
  '.pdf': { Icon: FileText, color: '#e5252a' },
  '.zip': { Icon: Package, color: '#c4a000' },
  '.lock': { Icon: Lock, color: '#8fa3b8' },
  '.r': { Icon: Sigma, color: '#276dc3' },
  '.jl': { Icon: Sigma, color: '#9558b2' },
  '.wasm': { Icon: Binary, color: '#654ff0' },
  '.nova-diagram.json': { Icon: Shapes, color: '#6ea8fe' },
}

const NAME_ICONS: Record<string, IconSpec> = {
  'package.json': { Icon: Package, color: '#cb3837' },
  'package-lock.json': { Icon: Lock, color: '#cb3837' },
  'pnpm-lock.yaml': { Icon: Lock, color: '#f69220' },
  'yarn.lock': { Icon: Lock, color: '#2c8ebb' },
  dockerfile: { Icon: Container, color: '#2496ed' },
  'docker-compose.yml': { Icon: Container, color: '#2496ed' },
  '.gitignore': { Icon: GitBranch, color: '#f05033' },
  '.gitattributes': { Icon: GitBranch, color: '#f05033' },
  makefile: { Icon: Cog, color: '#6d8086' },
  'readme.md': { Icon: FileText, color: '#6ea8fe' },
  'license': { Icon: FileText, color: '#d4b106' },
  'tsconfig.json': { Icon: Cog, color: '#3178c6' },
  'vite.config.ts': { Icon: Rocket, color: '#a259ff' },
}

export function fileIcon(path: string, pack: IconPack = 'nova'): IconSpec {
  const name = basename(path).toLowerCase()
  if (pack === 'minimal') return { Icon: FileIcon, color: 'var(--text-faint)' }

  if (path.endsWith('.nova-diagram.json')) return EXT_ICONS['.nova-diagram.json']
  if (NAME_ICONS[name]) {
    const spec = NAME_ICONS[name]
    return pack === 'classic' ? { ...spec, color: 'var(--text-muted)' } : spec
  }
  if (/\.(test|spec)\.[jt]sx?$/.test(name)) {
    return pack === 'classic'
      ? { Icon: TestTube, color: 'var(--text-muted)' }
      : { Icon: TestTube, color: '#8bc34a' }
  }

  const spec = EXT_ICONS[extname(path)] ?? { Icon: FileIcon, color: '#8fa3b8' }
  return pack === 'classic' ? { Icon: spec.Icon, color: 'var(--text-muted)' } : spec
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
