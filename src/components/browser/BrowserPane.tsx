import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  ExternalLink,
  Home,
  Loader2,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
  X,
} from 'lucide-react'
import { useStore } from '@/state/store'

type Device = 'responsive' | 'desktop' | 'tablet' | 'mobile'

const DEVICE_WIDTH: Record<Device, number | null> = {
  responsive: null,
  desktop: 1280,
  tablet: 834,
  mobile: 390,
}

interface WebviewElement extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  loadURL(url: string): Promise<void>
  getURL(): string
  openDevTools(): void
  setZoomFactor(factor: number): void
}

export default function BrowserPane({ tabId, initialUrl }: { tabId: string; initialUrl: string }) {
  const viewRef = useRef<WebviewElement | null>(null)
  const [address, setAddress] = useState(initialUrl)
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState('')
  /** The address that failed, which is not `currentUrl` — see `onFail`. */
  const [failedUrl, setFailedUrl] = useState('')
  const [device, setDevice] = useState<Device>('responsive')
  const [zoom, setZoom] = useState(1)
  const root = useStore((s) => s.root)
  const home = useStore((s) => s.settings.browserHome)

  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const onStart = () => {
      setLoading(true)
      setFailure('')
      setFailedUrl('')
    }
    const onStop = () => setLoading(false)
    const onNavigate = (e: Event) => {
      const url = (e as unknown as { url: string }).url
      setCurrentUrl(url)
      setAddress(url)
    }
    const onTitle = (e: Event) => {
      const title = (e as unknown as { title: string }).title
      useStore.getState().openTab({
        id: tabId,
        kind: 'browser',
        title: title ? title.slice(0, 28) : 'Browser',
        url: view.getURL(),
      })
    }
    const onFail = (e: Event) => {
      const detail = e as unknown as {
        errorCode: number
        errorDescription: string
        isMainFrame: boolean
        validatedURL: string
      }
      if (detail.isMainFrame && detail.errorCode !== -3) {
        setFailure(detail.errorDescription || `Failed to load (${detail.errorCode})`)
        // `did-navigate` never fires for a load that failed, so `currentUrl`
        // still holds the last page that worked. Naming *that* in the error
        // would tell the user the wrong address is broken.
        if (detail.validatedURL) setFailedUrl(detail.validatedURL)
        setLoading(false)
      }
    }

    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-navigate', onNavigate)
    view.addEventListener('did-navigate-in-page', onNavigate)
    view.addEventListener('page-title-updated', onTitle)
    view.addEventListener('did-fail-load', onFail)

    return () => {
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('did-navigate', onNavigate)
      view.removeEventListener('did-navigate-in-page', onNavigate)
      view.removeEventListener('page-title-updated', onTitle)
      view.removeEventListener('did-fail-load', onFail)
    }
  }, [tabId])

  const navigate = useCallback((raw: string) => {
    const view = viewRef.current
    if (!view) return
    let url = raw.trim()
    if (!url) return
    if (!/^[a-z]+:\/\//i.test(url)) {
      // Bare host:port and localhost paths are URLs; anything else is a search.
      url = /^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?/.test(url) || /^[\w-]+\.[a-z]{2,}/i.test(url)
        ? `http://${url}`
        : `https://duckduckgo.com/?q=${encodeURIComponent(url)}`
    }
    setFailure('')
    setFailedUrl('')
    void view.loadURL(url)
  }, [])

  const startDevServer = async () => {
    if (!root) return
    const detected = await window.nova.shell.detectDevServer(root)
    if (!detected) {
      useStore.getState().notify('No dev script found in package.json', 'error')
      return
    }
    useStore.getState().showPanel('terminal')
    window.dispatchEvent(
      new CustomEvent('nova:run-command', { detail: { command: detected.command } }),
    )
    useStore.getState().notify(`Running ${detected.command} — preview will load shortly`, 'info')
    setTimeout(() => navigate(detected.url), 3500)
  }

  const width = DEVICE_WIDTH[device]

  return (
    <div className="browser-pane">
      <div className="browser-toolbar">
        <button
          className="icon-btn"
          onClick={() => viewRef.current?.canGoBack() && viewRef.current.goBack()}
          title="Back"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => viewRef.current?.canGoForward() && viewRef.current.goForward()}
          title="Forward"
        >
          <ArrowRight size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => (loading ? viewRef.current?.stop() : viewRef.current?.reload())}
          title={loading ? 'Stop' : 'Reload'}
        >
          {loading ? <X size={15} /> : <RotateCw size={15} />}
        </button>
        <button className="icon-btn" onClick={() => navigate(home)} title="Home">
          <Home size={15} />
        </button>

        <div className="browser-address">
          {loading && <Loader2 size={12} className="spin faint" />}
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate(address)
              if (e.key === 'Escape') setAddress(currentUrl)
            }}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Enter a URL or search"
            spellCheck={false}
          />
        </div>

        <div className="segmented">
          <button
            className={device === 'responsive' ? 'active' : ''}
            onClick={() => setDevice('responsive')}
            title="Fill pane"
          >
            Fit
          </button>
          <button
            className={device === 'desktop' ? 'active' : ''}
            onClick={() => setDevice('desktop')}
            title="1280px"
          >
            <Monitor size={12} />
          </button>
          <button
            className={device === 'tablet' ? 'active' : ''}
            onClick={() => setDevice('tablet')}
            title="834px"
          >
            <Tablet size={12} />
          </button>
          <button
            className={device === 'mobile' ? 'active' : ''}
            onClick={() => setDevice('mobile')}
            title="390px"
          >
            <Smartphone size={12} />
          </button>
        </div>

        <select
          className="select"
          value={zoom}
          onChange={(e) => {
            const factor = Number(e.target.value)
            setZoom(factor)
            viewRef.current?.setZoomFactor(factor)
          }}
          title="Zoom"
        >
          {[0.5, 0.75, 1, 1.25, 1.5].map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>

        <button
          className="icon-btn"
          onClick={() => viewRef.current?.openDevTools()}
          title="Open page devtools"
        >
          <Bug size={15} />
        </button>
        <button
          className="icon-btn"
          onClick={() => void window.nova.app.openExternal(currentUrl)}
          title="Open in system browser"
        >
          <ExternalLink size={15} />
        </button>
      </div>

      <div className="browser-stage">
        <div
          className="browser-frame"
          // `flex: 1` in the stylesheet has a 0% basis, which would win over
          // `width`; a fixed preset must opt out of flexing to take effect.
          style={
            width
              ? { flex: '0 0 auto', width, maxWidth: '100%', margin: '0 auto' }
              : undefined
          }
        >
          {failure && (
            <div className="browser-error">
              <b>Could not load {failedUrl || currentUrl}</b>
              <span className="faint">{failure}</span>
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn sm" onClick={() => viewRef.current?.reload()}>
                  Retry
                </button>
                {root && (
                  <button className="btn sm primary" onClick={() => void startDevServer()}>
                    Start dev server
                  </button>
                )}
              </div>
            </div>
          )}
          <webview
            ref={viewRef as unknown as React.RefObject<HTMLElement>}
            src={initialUrl}
            partition="persist:nova-browser"
            style={{ display: 'flex', flex: 1, width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </div>
  )
}
