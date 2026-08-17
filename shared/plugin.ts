/**
 * The plugin contract.
 *
 * This file is the boundary between Nova and third-party code, so it is
 * deliberately the only thing a plugin author needs to read. It is shared by
 * three consumers that must not drift apart: the main process (validates and
 * installs), the renderer (renders the Plugins view), and the published SDK
 * typings that plugin authors compile against.
 *
 * A plugin is a git repository with a `nova-plugin.json` at its root. Nova
 * clones it, validates the manifest below, and — depending on what the manifest
 * declares — loads a JS entry point into an isolated host process, registers an
 * MCP server with the AI console, or both.
 */

/** Manifest schema version. Bumped only on a breaking change to the format. */
export const PLUGIN_MANIFEST_VERSION = 1

/**
 * What a plugin is allowed to do. Nothing is granted implicitly: a plugin that
 * declares no permissions gets an API surface that can only read the manifest
 * and register commands. The user sees this list before installing.
 */
export type PluginPermission =
  | 'workspace:read'
  | 'workspace:write'
  | 'editor'
  | 'ui'
  | 'shell'
  | 'net'
  | 'git'
  | 'secrets'

export const PLUGIN_PERMISSIONS: { id: PluginPermission; label: string; detail: string }[] = [
  { id: 'workspace:read', label: 'Read workspace files', detail: 'List and read any file in the open project.' },
  { id: 'workspace:write', label: 'Modify workspace files', detail: 'Create, edit and delete files in the open project.' },
  { id: 'editor', label: 'Editor access', detail: 'Read the active selection and apply edits to open buffers.' },
  { id: 'ui', label: 'Contribute UI', detail: 'Add views, status-bar items, commands and notifications.' },
  { id: 'shell', label: 'Run commands', detail: 'Execute processes on your machine.' },
  { id: 'net', label: 'Network access', detail: 'Make outbound network requests.' },
  { id: 'git', label: 'Git access', detail: 'Read repository history and status.' },
  { id: 'secrets', label: 'Secret storage', detail: 'Store and read its own credentials.' },
]

/** A command the plugin adds to the command palette. */
export interface PluginCommandContribution {
  /** Unique within the plugin. Namespaced to the plugin id at runtime. */
  id: string
  title: string
  category?: string
  /** Display-only; Nova does not bind keys on a plugin's behalf. */
  keybinding?: string
}

/** A panel or sidebar view rendered from HTML the plugin supplies. */
export interface PluginViewContribution {
  id: string
  title: string
  /** Lucide icon name, e.g. "Boxes". Falls back to a generic plugin glyph. */
  icon?: string
  location: 'sidebar' | 'panel'
}

/**
 * An MCP server the plugin ships. Nova merges these into the config it hands to
 * the Claude and Codex CLIs, so a plugin can hand the assistant new tools.
 */
export interface PluginMcpContribution {
  /** Unique within the plugin; namespaced to the plugin id when registered. */
  name: string
  /** stdio is the only transport the bundled CLIs accept from a local config. */
  transport?: 'stdio'
  command: string
  args?: string[]
  env?: Record<string, string>
  /** Relative to the plugin root. Defaults to the plugin root. */
  cwd?: string
  description?: string
}

export interface PluginContributions {
  commands?: PluginCommandContribution[]
  views?: PluginViewContribution[]
  mcpServers?: PluginMcpContribution[]
}

export interface PluginManifest {
  /** Reverse-DNS, e.g. "dev.nova.hello". Also the install directory name. */
  id: string
  name: string
  version: string
  description?: string
  author?: string
  homepage?: string
  license?: string
  /** Semver range of Nova this plugin supports, e.g. ">=0.1.0". */
  engine?: string
  /**
   * Entry module, relative to the plugin root. Loaded in the plugin host
   * process. Omit for a manifest-only plugin (one that just ships an MCP
   * server or static contributions).
   */
  main?: string
  /** Shell command run once after clone, e.g. "npm install && npm run build". */
  build?: string
  permissions?: PluginPermission[]
  contributes?: PluginContributions
  manifestVersion?: number
}

/** Where a plugin came from, so it can be updated or reinstalled. */
export interface PluginSource {
  kind: 'git' | 'local'
  /** The URL the user pasted, or the local path. */
  url: string
  /** Branch/tag the user asked for, if any. */
  ref?: string
  /** Resolved commit, recorded at install time so updates can be diffed. */
  commit?: string
}

export type PluginStatus = 'active' | 'disabled' | 'error' | 'installing'

/** A plugin as Nova has it on disk. */
export interface InstalledPlugin {
  manifest: PluginManifest
  source: PluginSource
  /** Absolute path to the plugin root. */
  dir: string
  enabled: boolean
  status: PluginStatus
  /** Populated when status is 'error'. */
  error?: string
  installedAt: number
  updatedAt?: number
  /** Permissions the user approved. A plugin cannot exceed these at runtime. */
  grantedPermissions: PluginPermission[]
}

/** Progress emitted while installing, so the UI can show a live log. */
export interface PluginInstallProgress {
  url: string
  stage: 'cloning' | 'validating' | 'building' | 'loading' | 'done' | 'error'
  message: string
  pluginId?: string
}

/** A log line from a plugin's host process, surfaced in the Plugins view. */
export interface PluginLogEvent {
  pluginId: string
  level: 'info' | 'warn' | 'error'
  text: string
  at: number
}

/** Something a running plugin registered at activation time. */
export interface PluginRuntimeState {
  pluginId: string
  commands: PluginCommandContribution[]
  views: PluginViewContribution[]
  statusBar: { id: string; text: string; tooltip?: string; command?: string }[]
}

/**
 * Rejects ids that would escape the plugins directory or collide with the
 * registry file. Exported because both the installer and the tests use it.
 */
export function isValidPluginId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(id) && id.length <= 128
}

/**
 * Validates a parsed manifest, returning the problems rather than throwing —
 * the installer reports every fault at once so an author does not fix them one
 * clone at a time.
 */
export function validateManifest(raw: unknown): { manifest?: PluginManifest; errors: string[] } {
  const errors: string[] = []
  if (!raw || typeof raw !== 'object') return { errors: ['nova-plugin.json is not a JSON object.'] }

  const m = raw as Record<string, unknown>

  if (!isValidPluginId(m.id)) {
    errors.push('`id` must be a dot/dash/underscore separated identifier, e.g. "dev.nova.hello".')
  }
  if (typeof m.name !== 'string' || !m.name.trim()) errors.push('`name` is required.')
  if (typeof m.version !== 'string' || !/^\d+\.\d+\.\d+/.test(m.version)) {
    errors.push('`version` must be semver, e.g. "1.0.0".')
  }
  if (m.main !== undefined && (typeof m.main !== 'string' || isEscaping(m.main))) {
    errors.push('`main` must be a path inside the plugin directory.')
  }
  if (m.build !== undefined && typeof m.build !== 'string') errors.push('`build` must be a string.')

  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions)) errors.push('`permissions` must be an array.')
    else {
      const known = new Set(PLUGIN_PERMISSIONS.map((p) => p.id))
      for (const p of m.permissions) {
        if (!known.has(p as PluginPermission)) errors.push(`Unknown permission "${String(p)}".`)
      }
    }
  }

  const contributes = m.contributes as PluginContributions | undefined
  if (contributes !== undefined) {
    if (typeof contributes !== 'object' || contributes === null) {
      errors.push('`contributes` must be an object.')
    } else {
      for (const c of contributes.commands ?? []) {
        if (!c || typeof c.id !== 'string' || typeof c.title !== 'string') {
          errors.push('Each `contributes.commands` entry needs an `id` and a `title`.')
          break
        }
      }
      for (const v of contributes.views ?? []) {
        if (!v || typeof v.id !== 'string' || (v.location !== 'sidebar' && v.location !== 'panel')) {
          errors.push('Each `contributes.views` entry needs an `id` and a `location` of "sidebar" or "panel".')
          break
        }
      }
      for (const s of contributes.mcpServers ?? []) {
        if (!s || typeof s.name !== 'string' || typeof s.command !== 'string') {
          errors.push('Each `contributes.mcpServers` entry needs a `name` and a `command`.')
          break
        }
        if (s.cwd && isEscaping(s.cwd)) {
          errors.push(`MCP server "${s.name}" has a \`cwd\` outside the plugin directory.`)
        }
      }
    }
  }

  // An MCP server is a process launch, so it cannot be declared without saying so.
  const perms = (Array.isArray(m.permissions) ? m.permissions : []) as PluginPermission[]
  if ((contributes?.mcpServers?.length ?? 0) > 0 && !perms.includes('shell')) {
    errors.push('Declaring `contributes.mcpServers` requires the "shell" permission.')
  }

  if (errors.length) return { errors }
  return { manifest: raw as PluginManifest, errors: [] }
}

/** True for paths that climb out of the plugin root or are absolute. */
function isEscaping(p: string): boolean {
  if (p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p)) return true
  return p.split(/[\\/]/).includes('..')
}
