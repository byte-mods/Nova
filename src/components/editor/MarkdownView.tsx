import { useState } from 'react'
import { Code2, Columns2, Eye } from 'lucide-react'
import { useStore } from '@/state/store'
import CodeEditor from './CodeEditor'
import Markdown from './Markdown'

type Mode = 'preview' | 'split' | 'source'

export default function MarkdownView({ path }: { path: string }) {
  const buffer = useStore((s) => s.buffers[path])
  const [mode, setMode] = useState<Mode>('split')

  if (!buffer) return <div className="empty-state">Loading…</div>

  return (
    <div className="md-view">
      <div className="md-toolbar">
        <div className="segmented">
          <button className={mode === 'source' ? 'active' : ''} onClick={() => setMode('source')}>
            <Code2 size={12} /> Source
          </button>
          <button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>
            <Columns2 size={12} /> Split
          </button>
          <button className={mode === 'preview' ? 'active' : ''} onClick={() => setMode('preview')}>
            <Eye size={12} /> Preview
          </button>
        </div>
        <span className="faint" style={{ marginLeft: 'auto', fontSize: 11 }}>
          Mermaid blocks render live
        </span>
      </div>
      <div className="md-body">
        {mode !== 'preview' && (
          <div className="md-pane" style={{ flex: mode === 'split' ? 1 : undefined, width: mode === 'source' ? '100%' : undefined }}>
            <CodeEditor path={path} />
          </div>
        )}
        {mode !== 'source' && (
          <div className="md-pane md-preview" style={{ flex: 1 }}>
            <Markdown content={buffer.content} basePath={path} />
          </div>
        )}
      </div>
    </div>
  )
}
