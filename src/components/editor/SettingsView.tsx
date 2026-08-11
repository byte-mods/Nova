import { Check, RefreshCw } from 'lucide-react'
import { useStore } from '@/state/store'
import { themes } from '@/theme/themes'

export default function SettingsView() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const providers = useStore((s) => s.providers)

  return (
    <div className="settings-view">
      <h1>Settings</h1>

      <section>
        <h2>Theme</h2>
        <div className="theme-grid">
          {themes.map((theme) => (
            <button
              key={theme.id}
              className={`theme-tile ${settings.themeId === theme.id ? 'active' : ''}`}
              onClick={() => setSettings({ themeId: theme.id })}
              style={{ background: theme.colors.editorBg, borderColor: theme.colors.border }}
            >
              <div className="theme-tile-bars">
                <i style={{ background: theme.syntax.keyword }} />
                <i style={{ background: theme.syntax.func }} />
                <i style={{ background: theme.syntax.string }} />
                <i style={{ background: theme.syntax.type }} />
                <i style={{ background: theme.syntax.number }} />
              </div>
              <span style={{ color: theme.colors.text }}>{theme.name}</span>
              {settings.themeId === theme.id && (
                <Check size={14} style={{ color: theme.colors.accent }} />
              )}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h2>Editor</h2>
        <div className="settings-grid">
          <Field label="Font size">
            <input
              type="number"
              min={9}
              max={26}
              value={settings.fontSize}
              onChange={(e) => setSettings({ fontSize: Number(e.target.value) })}
            />
          </Field>
          <Field label="Font family">
            <input
              value={settings.fontFamily}
              onChange={(e) => setSettings({ fontFamily: e.target.value })}
            />
          </Field>
          <Field label="Tab size">
            <input
              type="number"
              min={1}
              max={8}
              value={settings.tabSize}
              onChange={(e) => setSettings({ tabSize: Number(e.target.value) })}
            />
          </Field>
          <Field label="File icons">
            <select
              className="select"
              value={settings.iconPack}
              onChange={(e) => setSettings({ iconPack: e.target.value as typeof settings.iconPack })}
            >
              <option value="nova">Nova (colourful)</option>
              <option value="classic">Classic (monochrome)</option>
              <option value="minimal">Minimal</option>
            </select>
          </Field>
        </div>
        <div className="toggle-row">
          <Toggle
            label="Word wrap"
            value={settings.wordWrap}
            onChange={(v) => setSettings({ wordWrap: v })}
          />
          <Toggle
            label="Minimap"
            value={settings.minimap}
            onChange={(v) => setSettings({ minimap: v })}
          />
          <Toggle
            label="Line numbers"
            value={settings.lineNumbers}
            onChange={(v) => setSettings({ lineNumbers: v })}
          />
          <Toggle
            label="Auto save"
            value={settings.autoSave}
            onChange={(v) => setSettings({ autoSave: v })}
          />
        </div>
      </section>

      <section>
        <h2>AI console</h2>
        <div className="settings-grid">
          <Field label="Provider">
            <select
              className="select"
              value={settings.aiProvider}
              onChange={(e) => setSettings({ aiProvider: e.target.value as 'claude' | 'codex' })}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}
                  {p.available ? '' : ' (not installed)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model override">
            <input
              value={settings.aiModel}
              placeholder="e.g. opus, sonnet, gpt-5-codex"
              onChange={(e) => setSettings({ aiModel: e.target.value })}
            />
          </Field>
          <Field label="Permission mode">
            <select
              className="select"
              value={settings.aiPermissionMode}
              onChange={(e) =>
                setSettings({ aiPermissionMode: e.target.value as typeof settings.aiPermissionMode })
              }
            >
              <option value="acceptEdits">Accept edits (recommended)</option>
              <option value="plan">Plan only — no writes</option>
              <option value="default">Ask for permission</option>
              <option value="bypassPermissions">Bypass all checks</option>
            </select>
          </Field>
          <Field label="Browser home page">
            <input
              value={settings.browserHome}
              onChange={(e) => setSettings({ browserHome: e.target.value })}
            />
          </Field>
        </div>

        <div className="provider-list">
          {providers.map((p) => (
            <div key={p.id} className="provider-row">
              <span
                className="provider-dot"
                style={{ background: p.available ? 'var(--success)' : 'var(--danger)' }}
              />
              <b>{p.label}</b>
              <span className="faint mono" style={{ fontSize: 11 }}>
                {p.available ? `${p.binary} · ${p.version}` : p.hint}
              </span>
            </div>
          ))}
          <button
            className="btn sm"
            onClick={() =>
              void window.nova.ai.providers().then((p) => useStore.getState().setProviders(p))
            }
          >
            <RefreshCw size={12} /> Re-detect CLIs
          </button>
        </div>
      </section>

      <LanguageServers />
      <Debuggers />
    </div>
  )
}

function Debuggers() {
  const adapters = useStore((s) => s.debug.adapters)
  const installed = adapters.filter((a) => a.installed)
  const missing = adapters.filter((a) => !a.installed)

  return (
    <section>
      <h2>Debuggers</h2>
      <p className="faint" style={{ margin: '-6px 0 14px', fontSize: 12.5, maxWidth: 640, lineHeight: 1.6 }}>
        Nova speaks the Debug Adapter Protocol. Any adapter on your{' '}
        <code className="mono">PATH</code> can set breakpoints, step, inspect variables and evaluate
        expressions. Adapters marked <b>binary</b> debug a compiled executable — build first, then
        point Nova at the output.
      </p>

      <div className="lsp-list">
        {installed.map((adapter) => (
          <div key={adapter.id} className="lsp-row">
            <span className="provider-dot" style={{ background: 'var(--success)' }} />
            <div className="lsp-meta">
              <b>{adapter.label}</b>
              <span className="faint mono">{adapter.binary}</span>
            </div>
            <span className="chip">{adapter.languages.join(', ')}</span>
            <span className="chip">{adapter.programKind}</span>
          </div>
        ))}
        {installed.length === 0 && <span className="faint">No debug adapters detected.</span>}
      </div>

      <details style={{ marginTop: 14 }}>
        <summary className="faint" style={{ cursor: 'pointer', fontSize: 12.5 }}>
          {missing.length} more supported — install to enable
        </summary>
        <div className="lsp-list" style={{ marginTop: 10 }}>
          {missing.map((adapter) => (
            <div key={adapter.id} className="lsp-row muted-row">
              <span className="provider-dot" style={{ background: 'var(--border-strong)' }} />
              <div className="lsp-meta">
                <b>{adapter.label}</b>
                <span className="faint mono">{adapter.install}</span>
              </div>
              <span className="chip">{adapter.languages.join(', ')}</span>
            </div>
          ))}
        </div>
      </details>

      <button
        className="btn sm"
        style={{ marginTop: 14 }}
        onClick={() =>
          void window.nova.debug
            .detect(true)
            .then(() => useStore.getState().detectDebugAdapters())
        }
      >
        <RefreshCw size={12} /> Re-scan for adapters
      </button>
    </section>
  )
}

const STATE_COLOR: Record<string, string> = {
  ready: 'var(--success)',
  starting: 'var(--warning)',
  failed: 'var(--danger)',
  stopped: 'var(--text-faint)',
}

function LanguageServers() {
  const servers = useStore((s) => s.lspServers)
  const installed = servers.filter((s) => s.installed)
  const missing = servers.filter((s) => !s.installed)

  return (
    <section>
      <h2>Language servers</h2>
      <p className="faint" style={{ margin: '-6px 0 14px', fontSize: 12.5, maxWidth: 640, lineHeight: 1.6 }}>
        Nothing is bundled. Any server already on your <code className="mono">PATH</code> is used
        automatically for type-aware completion, diagnostics, rename and quick fixes. Without one,
        navigation still works through Nova's own symbol index.
      </p>

      <div className="lsp-list">
        {installed.map((server) => (
          <div key={server.id} className="lsp-row">
            <span className="provider-dot" style={{ background: STATE_COLOR[server.state] }} />
            <div className="lsp-meta">
              <b>{server.label}</b>
              <span className="faint mono">{server.binary}</span>
            </div>
            <span className="chip">{server.languages.join(', ')}</span>
            <span className="chip" style={{ color: STATE_COLOR[server.state] }}>
              {server.progress || server.state}
            </span>
            {server.error && (
              <span className="faint" style={{ fontSize: 11, color: 'var(--danger)' }}>
                {server.error}
              </span>
            )}
            <button
              className="btn sm"
              onClick={() => void useStore.getState().restartLspServer(server.id)}
            >
              Restart
            </button>
          </div>
        ))}
        {installed.length === 0 && (
          <span className="faint">No language servers detected on PATH.</span>
        )}
      </div>

      <details style={{ marginTop: 14 }}>
        <summary className="faint" style={{ cursor: 'pointer', fontSize: 12.5 }}>
          {missing.length} more supported — install to enable
        </summary>
        <div className="lsp-list" style={{ marginTop: 10 }}>
          {missing.map((server) => (
            <div key={server.id} className="lsp-row muted-row">
              <span className="provider-dot" style={{ background: 'var(--border-strong)' }} />
              <div className="lsp-meta">
                <b>{server.label}</b>
                <span className="faint mono">{server.install}</span>
              </div>
              <span className="chip">{server.languages.join(', ')}</span>
            </div>
          ))}
        </div>
      </details>

      <button
        className="btn sm"
        style={{ marginTop: 14 }}
        onClick={() =>
          void window.nova.lsp.detect(true).then((s) => useStore.getState().setLspServers(s))
        }
      >
        <RefreshCw size={12} /> Re-scan for servers
      </button>
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button className={`toggle ${value ? 'on' : ''}`} onClick={() => onChange(!value)}>
      <span className="toggle-track">
        <span className="toggle-thumb" />
      </span>
      {label}
    </button>
  )
}
