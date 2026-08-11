export function basename(p: string) {
  const parts = p.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? p
}

export function dirname(p: string) {
  const idx = p.lastIndexOf('/')
  return idx <= 0 ? '/' : p.slice(0, idx)
}

export function extname(p: string) {
  const base = basename(p)
  const idx = base.lastIndexOf('.')
  return idx <= 0 ? '' : base.slice(idx).toLowerCase()
}

export function joinPath(...parts: string[]) {
  return parts
    .filter(Boolean)
    .join('/')
    .replace(/\/{2,}/g, '/')
}

export function relative(root: string, p: string) {
  if (!root) return p
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`
  return p.startsWith(normalizedRoot) ? p.slice(normalizedRoot.length) : p
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function timeAgo(unixSeconds: number) {
  const seconds = Math.floor(Date.now() / 1000 - unixSeconds)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
