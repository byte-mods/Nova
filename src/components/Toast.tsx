import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import { useStore } from '@/state/store'

export default function Toast() {
  const toast = useStore((s) => s.toast)
  if (!toast) return null

  const Icon = toast.tone === 'error' ? AlertTriangle : toast.tone === 'success' ? CheckCircle2 : Info
  const color =
    toast.tone === 'error' ? 'var(--danger)' : toast.tone === 'success' ? 'var(--success)' : 'var(--accent)'

  return (
    <div className="toast fade-in">
      <Icon size={15} style={{ color, flexShrink: 0 }} />
      <span>{toast.text}</span>
    </div>
  )
}
