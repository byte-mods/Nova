/**
 * The Plugins view: install from git, then manage what is installed.
 *
 * Installing runs someone else's build script and, if the plugin ships an MCP
 * server, hands the assistant new tools. So the permission list is not a
 * collapsed detail — it is shown before the install button is usable, and the
 * user ticks what they will grant. A plugin that asks for `shell` and gets told
 * no still installs; it just cannot spawn anything.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Server,
  Trash2,
} from 'lucide-react'
import { useStore } from '@/state/store'
import { PLUGIN_PERMISSIONS, type InstalledPlugin, type PluginPermission } from '@shared/plugin'

export default function PluginsView() {
  const plugins = useStore((s) => s.plugins)
  const install = useStore((s) => s.pluginInstall)
  const [url, setUrl] = useState('')
  const [ref, setRef] = useState('')
  const [granting, setGranting] = useState<PluginPermission[]>([])
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    void useStore.getState().refreshPlugins()
  }, [])

  const busy = install?.stage !== undefined && install.stage !== 'done' && install.stage !== 'error'

  async function submit(allowBuild = false) {
    if (!url.trim() || busy) return
    const ok = await useStore.getState().installPlugin(url.trim(), {
      ref: ref.trim() || undefined,
      permissions: granting,
      allowBuild,
    })
    if (ok) {
      setUrl('')
      setRef('')
      setGranting([])
    }
  }

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Plugins</span>
        <button
          className="icon-btn"
          title="Reload the installed list"
          onClick={() => void useStore.getState().refreshPlugins()}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="plugin-install">
        <label className="plugin-label">Install from git</label>
        <input
          placeholder="https://github.com/user/nova-plugin-example"
          value={url}
          spellCheck={false}
          style={{ width: '100%' }}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />

        <button
          className="plugin-advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Branch and permissions
        </button>

        {showAdvanced && (
          <>
            <input
              placeholder="Branch or tag (default: the repo's default branch)"
              value={ref}
              spellCheck={false}
              style={{ width: '100%' }}
              onChange={(e) => setRef(e.target.value)}
            />
            <div className="plugin-perm-grid">
              {PLUGIN_PERMISSIONS.map((p) => (
                <label key={p.id} className="plugin-perm" title={p.detail}>
                  <input
                    type="checkbox"
                    checked={granting.includes(p.id)}
                    onChange={(e) =>
                      setGranting((g) => (e.target.checked ? [...g, p.id] : g.filter((x) => x !== p.id)))
                    }
                  />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
            <p className="plugin-hint">
              Only permissions the plugin's manifest asks for are actually granted. Leave these
              unticked to grant everything it declares.
            </p>
          </>
        )}

        <button className="btn primary sm" disabled={!url.trim() || busy} onClick={() => void submit()}>
          {busy ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
          {busy ? 'Installing…' : 'Install'}
        </button>

        {install?.stage === 'needs-build-consent' ? (
          /*
           * The one screen between pasting a URL and running that repository's
           * shell. The command is shown verbatim rather than summarised: the
           * whole value of asking is that the user sees what will run.
           */
          <div className="plugin-consent">
            <div className="plugin-consent-head">
              <AlertTriangle size={12} />
              <span>{install.message}</span>
            </div>
            <pre className="plugin-consent-cmd">{install.buildCommand}</pre>
            <p className="plugin-hint">
              This runs on your machine with your permissions, before any of the permissions
              above apply to it. Install it only if you trust the repository.
            </p>
            <div className="plugin-consent-actions">
              <button className="btn sm" onClick={() => useStore.getState().setPluginInstall(null)}>
                Cancel
              </button>
              <button className="btn primary sm" onClick={() => void submit(true)}>
                Run it and install
              </button>
            </div>
          </div>
        ) : (
          install && (
            <div className={`plugin-progress ${install.stage === 'error' ? 'error' : ''}`}>
              {install.stage === 'error' && <AlertTriangle size={12} />}
              <pre>{install.message}</pre>
            </div>
          )
        )}
      </div>

      <div className="sidebar-scroll" style={{ padding: '2px 10px 20px' }}>
        {!plugins.length && (
          <p className="faint" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 8 }}>
            No plugins yet. Paste a repository URL above — Nova clones it, reads its
            <code className="mono"> nova-plugin.json</code>, and loads it.
          </p>
        )}
        {plugins.map((plugin) => (
          <PluginCard key={plugin.manifest.id} plugin={plugin} />
        ))}
      </div>
    </>
  )
}

function PluginCard({ plugin }: { plugin: InstalledPlugin }) {
  const runtime = useStore((s) => s.pluginRuntime.find((r) => r.pluginId === plugin.manifest.id))
  const [open, setOpen] = useState(false)
  const { manifest } = plugin

  const ungranted = useMemo(
    () => (manifest.permissions ?? []).filter((p) => !plugin.grantedPermissions.includes(p)),
    [manifest.permissions, plugin.grantedPermissions],
  )
  const mcpServers = manifest.contributes?.mcpServers ?? []

  return (
    <div className={`plugin-card ${plugin.status === 'error' ? 'error' : ''}`}>
      <div className="plugin-card-head" onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Boxes size={13} className="plugin-icon" />
        <div className="plugin-title">
          <span className="plugin-name">{manifest.name}</span>
          <span className="plugin-version mono">{manifest.version}</span>
        </div>
        {!plugin.enabled && <span className="chip">disabled</span>}
        {plugin.status === 'error' && <span className="chip danger">error</span>}
        {mcpServers.length > 0 && (
          <span className="chip" title={`${mcpServers.length} MCP server(s) for the AI console`}>
            <Server size={9} /> MCP
          </span>
        )}
      </div>

      {open && (
        <div className="plugin-card-body">
          {manifest.description && <p className="plugin-desc">{manifest.description}</p>}

          <div className="plugin-meta mono">
            <span>{manifest.id}</span>
            {manifest.author && <span>by {manifest.author}</span>}
          </div>

          {plugin.error && <pre className="plugin-error">{plugin.error}</pre>}

          {ungranted.length > 0 && (
            <div className="plugin-warn">
              <AlertTriangle size={12} />
              <div>
                <strong>Not fully granted.</strong> This plugin asks for{' '}
                {ungranted.join(', ')} but has not been given it.
                <button
                  className="link-btn"
                  title={`Give this plugin ${ungranted.join(', ')}`}
                  onClick={() => void useStore.getState().grantPluginPermissions(manifest.id, ungranted)}
                >
                  Grant now
                </button>
              </div>
            </div>
          )}

          {plugin.grantedPermissions.length > 0 && (
            <div className="plugin-perms-granted">
              {plugin.grantedPermissions.map((p) => (
                <span key={p} className="chip">
                  {p}
                </span>
              ))}
            </div>
          )}

          {mcpServers.length > 0 && (
            <div className="plugin-section">
              <span className="plugin-label">MCP servers</span>
              {mcpServers.map((s) => (
                <div key={s.name} className="plugin-row">
                  <Server size={11} />
                  <span className="mono">{s.name}</span>
                  <span className="plugin-row-detail">{s.description || `${s.command} ${(s.args ?? []).join(' ')}`}</span>
                </div>
              ))}
              <p className="plugin-hint">
                These tools are handed to the Claude and Codex CLIs on the next prompt.
              </p>
            </div>
          )}

          {(runtime?.commands.length ?? 0) > 0 && (
            <div className="plugin-section">
              <span className="plugin-label">Commands</span>
              {runtime!.commands.map((c) => (
                <div key={c.id} className="plugin-row">
                  <span className="mono">{c.title}</span>
                  <button
                    className="icon-btn"
                    title="Run this command"
                    onClick={() => void useStore.getState().runPluginCommand(manifest.id, c.id)}
                  >
                    <Play size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="plugin-actions">
            <button
              className="btn"
              onClick={() => void useStore.getState().setPluginEnabled(manifest.id, !plugin.enabled)}
            >
              <Power size={12} /> {plugin.enabled ? 'Disable' : 'Enable'}
            </button>
            {plugin.source.kind === 'git' && (
              <button className="btn" onClick={() => void useStore.getState().updatePluginById(manifest.id)}>
                <RefreshCw size={12} /> Update
              </button>
            )}
            {manifest.homepage && (
              <button
                className="btn"
                onClick={() => void window.nova.app.openExternal(manifest.homepage!)}
              >
                <ExternalLink size={12} /> Homepage
              </button>
            )}
            <button
              className="btn danger"
              onClick={() => {
                if (confirm(`Uninstall ${manifest.name}? Its directory will be deleted.`)) {
                  void useStore.getState().uninstallPlugin(manifest.id)
                }
              }}
            >
              <Trash2 size={12} /> Uninstall
            </button>
          </div>

          <div className="plugin-source mono" title={plugin.source.url}>
            {plugin.source.url}
            {plugin.source.commit && ` @ ${plugin.source.commit.slice(0, 8)}`}
          </div>
        </div>
      )}
    </div>
  )
}
