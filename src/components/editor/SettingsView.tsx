import { useEffect, useState } from 'react'
import { Check, RefreshCw, RotateCcw } from 'lucide-react'
import type { AiProvider } from '@shared/types'
import { keyedProviders, providerStateLabel } from '@shared/aiProviders'
import { useStore } from '@/state/store'
import { themes } from '@/theme/themes'
import { inspectionCatalogue } from '@/lib/inspections'
import { SHORTCUT_ACTIONS, comboFromEvent, describeCombo, effectiveCombo } from '@/lib/keymap'

/** Rebind rows: click the combo, press the new keys. */
function KeymapEditor() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [capturing, setCapturing] = useState<string | null>(null)

  const setBinding = (id: string, combo: string | null) => {
    const next = { ...settings.keymap }
    if (combo === null) delete next[id]
    else next[id] = combo
    setSettings({ keymap: next })
  }

  return (
    <div style={{ display: 'grid', gap: 4, maxWidth: 640 }}>
      {SHORTCUT_ACTIONS.map((action) => {
        const combo = effectiveCombo(action, settings.keymap)
        const overridden = settings.keymap[action.id] !== undefined
        const isCapturing = capturing === action.id
        return (
          <div key={action.id} className="row" style={{ gap: 8 }}>
            <span style={{ fontSize: 12.5, flex: 1 }}>{action.label}</span>
            <button
              className={`btn sm ${isCapturing ? 'primary' : ''}`}
              style={{ minWidth: 110, fontFamily: 'inherit' }}
              onClick={() => setCapturing(action.id)}
              onKeyDown={(e) => {
                if (!isCapturing) return
                e.preventDefault()
                e.stopPropagation()
                if (e.key === 'Escape') {
                  setCapturing(null)
                  return
                }
                if (e.key === 'Backspace' || e.key === 'Delete') {
                  setBinding(action.id, '')
                  setCapturing(null)
                  return
                }
                const combo2 = comboFromEvent(e.nativeEvent)
                if (combo2) {
                  setBinding(action.id, combo2)
                  setCapturing(null)
                }
              }}
              onBlur={() => setCapturing(null)}
            >
              {isCapturing ? 'Press keys…' : combo ? describeCombo(combo) : '—'}
            </button>
            {overridden && (
              <button
                className="icon-btn"
                style={{ width: 22, height: 22 }}
                title="Reset to default"
                onClick={() => setBinding(action.id, null)}
              >
                <RotateCcw size={12} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** One severity dropdown per rule; absent from the profile means the default. */
function InspectionProfileEditor() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const rules = inspectionCatalogue()

  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {rules.map((rule) => {
        const value = settings.inspectionProfile[rule.id] ?? rule.defaultSeverity
        return (
          <div key={rule.id} className="row" style={{ gap: 8 }} title={rule.description}>
            <select
              className="select"
              style={{ width: 100 }}
              value={value}
              onChange={(e) =>
                setSettings({
                  inspectionProfile: {
                    ...settings.inspectionProfile,
                    [rule.id]: e.target.value as typeof value,
                  },
                })
              }
            >
              <option value="error">error</option>
              <option value="warning">warning</option>
              <option value="info">info</option>
              <option value="off">off</option>
            </select>
            <span style={{ fontSize: 12.5 }}>{rule.name}</span>
            <code className="mono faint" style={{ fontSize: 10.5, marginLeft: 'auto' }}>
              {rule.id}
            </code>
          </div>
        )
      })}
    </div>
  )
}

export default function SettingsView() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const providers = useStore((s) => s.providers)
  const [localModels, setLocalModels] = useState<string[]>([])

  // Refreshed on open rather than cached in the store: models are pulled and
  // removed outside Nova, so a list from an hour ago is worse than none.
  useEffect(() => {
    let cancelled = false
    window.nova.ai
      .localModels()
      .then((models) => {
        if (!cancelled) setLocalModels(models)
      })
      .catch(() => setLocalModels([]))
    return () => {
      cancelled = true
    }
  }, [])

  const setCodeStyle = (patch: Partial<typeof settings.codeStyle>) =>
    setSettings({ codeStyle: { ...settings.codeStyle, ...patch } })

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
          <Toggle
            label="Breadcrumbs"
            value={settings.breadcrumbs}
            onChange={(v) => setSettings({ breadcrumbs: v })}
          />
          <Toggle
            label="Code vision (usage counts)"
            value={settings.codeVision}
            onChange={(v) => setSettings({ codeVision: v })}
          />
        </div>
      </section>

      <section>
        <h2>Keymap</h2>
        <p className="faint" style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.6 }}>
          Application-level shortcuts. Click a binding and press the new combination; Backspace
          unbinds, Escape cancels. Editor-local bindings (multi-cursor, folding…) follow Monaco’s
          keymap and are listed in Find Action.
        </p>
        <KeymapEditor />
      </section>

      <section>
        <h2>Code style</h2>
        <p className="faint" style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.6 }}>
          The baseline for Reformat Code (⌥⌘L) and Optimize Imports (⌃⌥O). A{' '}
          <code className="mono">.editorconfig</code> in the project overrides these per file, and a
          language server’s own formatter takes precedence over the built-in one.
        </p>
        <div className="settings-grid">
          <Field label="Indent size">
            <input
              type="number"
              min={1}
              max={8}
              value={settings.codeStyle.indentSize}
              onChange={(e) => setCodeStyle({ indentSize: Number(e.target.value) })}
            />
          </Field>
          <Field label="Max line length">
            <input
              type="number"
              min={40}
              max={400}
              value={settings.codeStyle.maxLineLength}
              onChange={(e) => setCodeStyle({ maxLineLength: Number(e.target.value) })}
            />
          </Field>
          <Field label="Blank lines to keep">
            <input
              type="number"
              min={0}
              max={10}
              value={settings.codeStyle.maxBlankLines}
              onChange={(e) => setCodeStyle({ maxBlankLines: Number(e.target.value) })}
            />
          </Field>
          <Field label="Line endings">
            <select
              className="select"
              value={settings.codeStyle.endOfLine}
              onChange={(e) => setCodeStyle({ endOfLine: e.target.value as 'lf' | 'crlf' })}
            >
              <option value="lf">LF (Unix)</option>
              <option value="crlf">CRLF (Windows)</option>
            </select>
          </Field>
          <Field label="Import order">
            <select
              className="select"
              value={settings.codeStyle.importOrder}
              onChange={(e) => setCodeStyle({ importOrder: e.target.value as 'keep' | 'alphabetical' })}
            >
              <option value="alphabetical">Alphabetical</option>
              <option value="keep">Keep as written</option>
            </select>
          </Field>
        </div>
        <div className="toggle-row">
          <Toggle label="Use tabs" value={settings.codeStyle.useTabs} onChange={(v) => setCodeStyle({ useTabs: v })} />
          <Toggle
            label="Re-indent by bracket depth"
            value={settings.codeStyle.reindent}
            onChange={(v) => setCodeStyle({ reindent: v })}
          />
          <Toggle
            label="Normalize , and ; spacing"
            value={settings.codeStyle.normalizeSpacing}
            onChange={(v) => setCodeStyle({ normalizeSpacing: v })}
          />
          <Toggle
            label="Trim trailing whitespace"
            value={settings.codeStyle.trimTrailingWhitespace}
            onChange={(v) => setCodeStyle({ trimTrailingWhitespace: v })}
          />
          <Toggle
            label="Final newline"
            value={settings.codeStyle.insertFinalNewline}
            onChange={(v) => setCodeStyle({ insertFinalNewline: v })}
          />
          <Toggle
            label="Remove unused imports"
            value={settings.codeStyle.removeUnusedImports}
            onChange={(v) => setCodeStyle({ removeUnusedImports: v })}
          />
          <Toggle
            label="Blank line between import groups"
            value={settings.codeStyle.groupImports}
            onChange={(v) => setCodeStyle({ groupImports: v })}
          />
          <Toggle
            label="Format on save"
            value={settings.formatOnSave}
            onChange={(v) => setSettings({ formatOnSave: v })}
          />
          <Toggle
            label="Optimize imports on save"
            value={settings.optimizeImportsOnSave}
            onChange={(v) => setSettings({ optimizeImportsOnSave: v })}
          />
        </div>
      </section>

      <section>
        <h2>Inspections</h2>
        <p className="faint" style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.6 }}>
          Applied live in the editor and by the project-wide Inspect Code run. “Off” disables a rule
          everywhere; a single line can be suppressed with{' '}
          <code className="mono">// nova-ignore &lt;rule-id&gt;</code>.
        </p>
        <div className="toggle-row" style={{ marginBottom: 8 }}>
          <Toggle
            label="Enable inspections"
            value={settings.inspectionsEnabled}
            onChange={(v) => setSettings({ inspectionsEnabled: v })}
          />
        </div>
        <InspectionProfileEditor />
      </section>

      <section>
        <h2>AI console</h2>
        <div className="settings-grid">
          <Field label="Provider">
            <select
              className="select"
              value={settings.aiProvider}
              onChange={(e) => setSettings({ aiProvider: e.target.value as AiProvider })}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.available}>
                  {p.label}
                  {providerStateLabel(p) ? ` (${providerStateLabel(p)})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Model override">
            <input
              value={settings.aiModel}
              list="nova-local-models"
              placeholder={
                settings.aiProvider === 'opencode'
                  ? 'e.g. qwen2.5-coder:0.5b — or provider/model'
                  : 'e.g. opus, sonnet, gpt-5.3-codex'
              }
              onChange={(e) => setSettings({ aiModel: e.target.value })}
            />
            {/* The models Ollama has actually pulled, so the local provider is
                not a guessing game about spelling and tags. */}
            <datalist id="nova-local-models">
              {localModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            {settings.aiProvider === 'opencode' && localModels.length === 0 && (
              <small className="faint">
                No local models found. Pull a small one first, e.g.{' '}
                <code>ollama pull qwen2.5-coder:0.5b</code>.
              </small>
            )}
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
          <Field label="Keep going — turn limit">
            <input
              type="number"
              min={0}
              value={settings.aiAutoMaxIterations ?? 0}
              onChange={(e) =>
                setSettings({ aiAutoMaxIterations: Math.max(0, Number(e.target.value) || 0) })
              }
            />
            <small className="faint">
              How many turns an unattended run may take before it stops on its own.{' '}
              <strong>0 means no limit</strong> — it runs until the tests pass, something
              genuinely needs you, or three turns go by without a single file changing.
              Stop ends it at any point. An unattended run spends tokens without asking
              between turns, so a limit here is the one cost ceiling that does not depend
              on anyone watching.
            </small>
          </Field>
          <Field label="Browser home page">
            <input
              value={settings.browserHome}
              onChange={(e) => setSettings({ browserHome: e.target.value })}
            />
          </Field>
        </div>

        <VendorKeys />

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

/**
 * Keys and endpoints for the vendor providers.
 *
 * A key that has been saved is never read back — the main process stores it in
 * the OS keychain and will only say whether one exists. So the field shows a
 * placeholder standing for "something is stored" rather than the value, and
 * pasting over it replaces it. Displaying the key would put it on screen during
 * exactly the screen-share this IDE now makes easy.
 */
function VendorKeys() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const [stored, setStored] = useState<AiProvider[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  const refresh = () => void window.nova.ai.storedKeys().then(setStored)
  useEffect(refresh, [])

  const save = async (provider: AiProvider) => {
    const value = drafts[provider] ?? ''
    const ok = await window.nova.ai.setKey(provider, value.trim() || null)
    setFailed(ok ? null : provider)
    if (ok) {
      setSaved(provider)
      setTimeout(() => setSaved(null), 2000)
      setDrafts((d) => ({ ...d, [provider]: '' }))
      refresh()
      void window.nova.ai.providers().then((list) => useStore.getState().setProviders(list))
    }
  }

  return (
    <div className="vendor-keys">
      <p className="faint" style={{ fontSize: 11, lineHeight: 1.6, margin: '0 0 8px' }}>
        Kimi, GLM and DeepSeek publish Anthropic-compatible endpoints, so Nova drives them with the
        Claude Code CLI pointed at a different address. Each needs its own key. Keys are kept in the
        OS keychain and are never shown again once saved.
      </p>

      {keyedProviders().map((spec) => {
        const has = stored.includes(spec.id)
        const urlKey = `aiBaseUrl_${spec.id}`
        const url = (settings.aiBaseUrls ?? {})[spec.id] ?? ''
        return (
          <div key={spec.id} className="vendor-key-row">
            <div className="vendor-key-head">
              <b>{spec.label}</b>
              {has ? (
                <span className="chip" title="A key is stored for this provider">
                  key saved
                </span>
              ) : (
                <span className="chip danger" title="No key stored — this provider cannot run">
                  no key
                </span>
              )}
              <button
                className="link-btn"
                title={`Open ${spec.label}'s console to create an API key`}
                onClick={() => void window.nova.app.openExternal(spec.console!)}
              >
                Get a key
              </button>
            </div>

            <div className="vendor-key-fields">
              <input
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={has ? '•••••••• stored — paste to replace' : 'Paste the API key'}
                value={drafts[spec.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [spec.id]: e.target.value }))}
              />
              <button
                className="btn sm"
                title={`Save this key for ${spec.label} in the OS keychain`}
                onClick={() => void save(spec.id)}
              >
                {saved === spec.id ? <Check size={11} /> : null}
                {saved === spec.id ? 'Saved' : 'Save'}
              </button>
              {has && (
                <button
                  className="btn sm danger"
                  title={`Forget the stored ${spec.label} key`}
                  onClick={async () => {
                    await window.nova.ai.setKey(spec.id, null)
                    refresh()
                    void window.nova.ai.providers().then((list) => useStore.getState().setProviders(list))
                  }}
                >
                  Forget
                </button>
              )}
            </div>

            <input
              key={urlKey}
              className="vendor-key-url mono"
              spellCheck={false}
              placeholder={spec.defaultModel ?? ''}
              title="Where requests go. Left blank, the vendor's documented address is used."
              value={url}
              onChange={(e) =>
                setSettings({
                  aiBaseUrls: { ...(settings.aiBaseUrls ?? {}), [spec.id]: e.target.value },
                })
              }
            />
            <small className="faint">
              Suggested model: <code className="mono">{spec.defaultModel!}</code> — put it
              in “Model override” when this provider is selected.
            </small>

            {failed === spec.id && (
              <small className="danger">
                This machine has no secure storage available, so the key was not saved.
              </small>
            )}
          </div>
        )
      })}
    </div>
  )
}
