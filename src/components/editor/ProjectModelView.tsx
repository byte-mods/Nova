/**
 * Project Structure — modules, SDKs and frameworks, as detected.
 *
 * Nothing here is editable, on purpose: the manifests on disk are the source
 * of truth, and this view is the map of what they declare — which module uses
 * what, which SDKs the machine actually has, and how modules depend on each
 * other. Clicking a module opens its manifest, which is where changes belong.
 */

import { useEffect, useState } from 'react'
import { Boxes, Package, RefreshCw, Wrench } from 'lucide-react'
import type { ProjectModel } from '../../../electron/lib/projectModel'
import { useStore } from '@/state/store'

export default function ProjectModelView() {
  const root = useStore((s) => s.root)
  const [model, setModel] = useState<ProjectModel | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    if (!root) return
    setLoading(true)
    try {
      setModel(await window.nova.app.projectModel(root))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [root])

  if (!root) return <div className="empty-state">Open a project first.</div>

  const installed = (model?.sdks ?? []).filter((sdk) => sdk.version)
  const missing = (model?.sdks ?? []).filter((sdk) => !sdk.version)

  return (
    <div style={{ padding: 20, overflow: 'auto', flex: 1 }}>
      <div className="row" style={{ gap: 8 }}>
        <h2 style={{ margin: 0 }}>Project Structure</h2>
        <button className="icon-btn" title="Re-detect" onClick={() => void refresh()}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <h3 style={{ marginTop: 18 }}>
        <Boxes size={14} style={{ verticalAlign: -2 }} /> Modules
      </h3>
      {model && model.modules.length === 0 && (
        <div className="faint">No build manifest found anywhere in the tree.</div>
      )}
      <div style={{ display: 'grid', gap: 6, maxWidth: 720 }}>
        {(model?.modules ?? []).map((module) => (
          <button
            key={module.dir || '(root)'}
            className="template-card"
            style={{ textAlign: 'left', display: 'block', padding: '8px 12px' }}
            title={`Open ${module.manifest}`}
            onClick={() =>
              void useStore.getState().openFile(`${root}/${module.dir ? `${module.dir}/` : ''}${module.manifest}`)
            }
          >
            <div className="row" style={{ gap: 8 }}>
              <Package size={13} style={{ color: 'var(--accent)' }} />
              <b style={{ fontSize: 13 }}>{module.name}</b>
              <span className="faint" style={{ fontSize: 11 }}>
                {module.dir || '(project root)'} · {module.language}
              </span>
              {module.engine && <span className="chip">{module.engine}</span>}
            </div>
            {(module.frameworks.length > 0 || module.dependsOn.length > 0) && (
              <div className="row" style={{ gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
                {module.frameworks.map((framework) => (
                  <span key={framework} className="chip" style={{ color: 'var(--accent)' }}>
                    {framework}
                  </span>
                ))}
                {module.dependsOn.length > 0 && (
                  <span className="faint" style={{ fontSize: 11 }}>
                    → depends on {module.dependsOn.join(', ')}
                  </span>
                )}
              </div>
            )}
          </button>
        ))}
      </div>

      <h3 style={{ marginTop: 22 }}>
        <Wrench size={14} style={{ verticalAlign: -2 }} /> SDKs on this machine
      </h3>
      <div style={{ display: 'grid', gap: 3, maxWidth: 720 }}>
        {installed.map((sdk) => (
          <div key={sdk.id} className="row" style={{ gap: 8, fontSize: 12.5 }}>
            <b style={{ minWidth: 70 }}>{sdk.label}</b>
            <code className="mono" style={{ fontSize: 11.5 }}>{sdk.version}</code>
            <span className="faint mono" style={{ fontSize: 10.5, marginLeft: 'auto' }}>{sdk.binary}</span>
          </div>
        ))}
        {missing.length > 0 && (
          <div className="faint" style={{ fontSize: 11.5, marginTop: 4 }}>
            Not installed: {missing.map((sdk) => sdk.label).join(', ')}
          </div>
        )}
      </div>
    </div>
  )
}
