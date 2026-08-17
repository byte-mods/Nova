/**
 * Exposes plugin-supplied MCP servers to the AI console.
 *
 * A plugin that declares `contributes.mcpServers` is handing the assistant new
 * tools — the most useful thing a plugin can do here, since the AI console is
 * where most of Nova's work happens. Both bundled CLIs accept local stdio MCP
 * servers, but they read different config shapes, so this module renders one
 * registry into each CLI's format and writes it somewhere the CLI will find it.
 *
 * The config is regenerated from the installed set on every AI run rather than
 * kept in sync incrementally: enabling a plugin mid-session should affect the
 * next prompt, and a stale server entry is worse than a slow write.
 */
import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { InstalledPlugin, PluginMcpContribution } from '../../shared/plugin'

export interface ResolvedMcpServer {
  /** Namespaced `<pluginId>__<name>`, so two plugins can ship the same name. */
  key: string
  pluginId: string
  pluginName: string
  contribution: PluginMcpContribution
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
}

/**
 * Collects the MCP servers every enabled, shell-granted plugin contributes.
 *
 * A plugin whose "shell" permission the user declined is skipped rather than
 * failing loudly: declining is a valid choice, and the plugin's other features
 * should keep working.
 */
export function collectMcpServers(plugins: InstalledPlugin[]): ResolvedMcpServer[] {
  const out: ResolvedMcpServer[] = []

  for (const plugin of plugins) {
    if (!plugin.enabled) continue
    const servers = plugin.manifest.contributes?.mcpServers ?? []
    if (!servers.length) continue
    if (!plugin.grantedPermissions.includes('shell')) continue

    for (const contribution of servers) {
      out.push({
        key: `${sanitise(plugin.manifest.id)}__${sanitise(contribution.name)}`,
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
        contribution,
        command: contribution.command,
        args: contribution.args ?? [],
        // The plugin's own directory is on PATH-adjacent env so a server can
        // find files it shipped without hard-coding an absolute path.
        env: { ...(contribution.env ?? {}), NOVA_PLUGIN_DIR: plugin.dir },
        cwd: contribution.cwd ? path.join(plugin.dir, contribution.cwd) : plugin.dir,
      })
    }
  }

  return out
}

/**
 * Writes a Claude-format MCP config and returns its path, or null when there is
 * nothing to contribute (so the caller can skip the `--mcp-config` flag).
 */
export async function writeClaudeMcpConfig(servers: ResolvedMcpServer[]): Promise<string | null> {
  if (!servers.length) return null

  const mcpServers: Record<string, unknown> = {}
  for (const s of servers) {
    mcpServers[s.key] = { type: 'stdio', command: s.command, args: s.args, env: s.env, cwd: s.cwd }
  }

  const file = path.join(app.getPath('userData'), 'plugin-mcp.claude.json')
  await fs.writeFile(file, JSON.stringify({ mcpServers }, null, 2), 'utf8')
  return file
}

/**
 * Renders the same registry as Codex's TOML overrides.
 *
 * Codex takes config as repeated `-c key=value` arguments rather than a file,
 * so this returns the argument list instead of a path.
 */
export function codexMcpArgs(servers: ResolvedMcpServer[]): string[] {
  const args: string[] = []
  for (const s of servers) {
    const prefix = `mcp_servers.${s.key}`
    args.push('-c', `${prefix}.command=${toml(s.command)}`)
    if (s.args.length) args.push('-c', `${prefix}.args=${tomlArray(s.args)}`)
    const envKeys = Object.keys(s.env)
    if (envKeys.length) {
      args.push('-c', `${prefix}.env=${tomlTable(s.env)}`)
    }
  }
  return args
}

/** Strips anything that would break a config key or collide across plugins. */
function sanitise(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function toml(value: string): string {
  return JSON.stringify(value)
}

function tomlArray(values: string[]): string {
  return `[${values.map(toml).join(',')}]`
}

function tomlTable(table: Record<string, string>): string {
  const body = Object.entries(table)
    .map(([k, v]) => `${JSON.stringify(k)}=${toml(v)}`)
    .join(',')
  return `{${body}}`
}
