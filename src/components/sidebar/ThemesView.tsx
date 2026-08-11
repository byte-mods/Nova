import { Check } from 'lucide-react'
import { useStore } from '@/state/store'
import { themes } from '@/theme/themes'

export default function ThemesView() {
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)

  return (
    <>
      <div className="sidebar-header">
        <span className="sidebar-title">Themes</span>
        <button
          className="btn ghost sm"
          onClick={() =>
            useStore.getState().openTab({ id: 'settings', kind: 'settings', title: 'Settings' })
          }
        >
          All settings
        </button>
      </div>

      <div className="sidebar-scroll" style={{ padding: '2px 10px 20px' }}>
        {themes.map((theme) => {
          const active = settings.themeId === theme.id
          return (
            <button
              key={theme.id}
              className={`theme-card ${active ? 'active' : ''}`}
              onClick={() => setSettings({ themeId: theme.id })}
            >
              <div
                className="theme-preview"
                style={{ background: theme.colors.editorBg, borderColor: theme.colors.border }}
              >
                <span style={{ background: theme.colors.sidebar }} />
                <div className="theme-preview-lines">
                  <i style={{ background: theme.syntax.keyword, width: '38%' }} />
                  <i style={{ background: theme.syntax.func, width: '58%' }} />
                  <i style={{ background: theme.syntax.string, width: '46%' }} />
                  <i style={{ background: theme.syntax.comment, width: '30%' }} />
                  <i style={{ background: theme.syntax.type, width: '52%' }} />
                </div>
              </div>
              <div className="theme-meta">
                <b>{theme.name}</b>
                <small>{theme.type}</small>
              </div>
              {active && <Check size={14} style={{ color: 'var(--accent)' }} />}
            </button>
          )
        })}

        <div className="sidebar-title" style={{ margin: '16px 0 8px' }}>
          File icons
        </div>
        <div className="segmented" style={{ width: '100%' }}>
          {(['nova', 'classic', 'minimal'] as const).map((pack) => (
            <button
              key={pack}
              className={settings.iconPack === pack ? 'active' : ''}
              onClick={() => setSettings({ iconPack: pack })}
              style={{ flex: 1, textTransform: 'capitalize' }}
            >
              {pack}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
