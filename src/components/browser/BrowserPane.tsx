import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bug,
  ExternalLink,
  Home,
  Loader2,
  Camera,
  Circle,
  Crosshair,
  Monitor,
  RotateCw,
  Save,
  Square,
  Smartphone,
  Tablet,
  X,
} from 'lucide-react'
import { useStore } from '@/state/store'
import { bestLocator, newChannelToken, parseMessage, recorderSource } from '@/lib/e2eRecorder'
import { tidy, toPlaywright } from '@/lib/e2eCodegen'
import type { Locator, RecordedAction } from '@shared/e2e'

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
  executeJavaScript(code: string): Promise<unknown>
  /** Identifies the guest's WebContents, so the main process can capture it. */
  getWebContentsId(): number
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

  const [recording, setRecording] = useState(false)
  const [picking, setPicking] = useState(false)
  const [actions, setActions] = useState<RecordedAction[]>([])
  const [inspected, setInspected] = useState<Locator | null>(null)
  const [visual, setVisual] = useState<string>('')
  /** Read by the console listener, which is registered once and must not go
   *  stale as the mode changes. */
  const modeRef = useRef({ recording: false, picking: false })
  modeRef.current = { recording, picking }

  // A channel per pane, minted once and injected with the script. A page can
  // still write to its own console; it cannot write to this prefix without
  // first reading it out of the script running inside it.
  const channelRef = useRef(newChannelToken())

  /**
   * Turns one recorder report into an action, choosing the locator here rather
   * than in the page: the ranking is the part worth being able to change and
   * test without a browser in the loop.
   */
  const handleRecorderMessage = useCallback((payload: Record<string, unknown>) => {
    const kind = payload.type as string
    if (kind === 'ready') return

    if (kind === 'press') {
      setActions((current) => [...current, { type: 'press', key: String(payload.key), at: Date.now() }])
      return
    }

    const locator = bestLocator((payload.candidates as Locator[]) ?? [])
    if (!locator) return

    if (kind === 'picked') {
      setInspected(locator)
      return
    }

    const at = Date.now()
    setActions((current) => {
      switch (kind) {
        case 'click':
          return [...current, { type: 'click', locator, at }]
        case 'fill':
          return [...current, { type: 'fill', locator, value: String(payload.value ?? ''), at }]
        case 'check':
          return [...current, { type: 'check', locator, checked: Boolean(payload.checked), at }]
        case 'select':
          return [...current, { type: 'select', locator, value: String(payload.value ?? ''), at }]
        default:
          return current
      }
    })
  }, [])

  /** Injects the recorder and puts it into one of its three modes. */
  const setMode = useCallback(async (next: 'record' | 'pick' | 'off') => {
    const view = viewRef.current
    if (!view) return
    try {
      await view.executeJavaScript(recorderSource(channelRef.current))
      if (next === 'record') await view.executeJavaScript('window.__novaE2E.start()')
      else if (next === 'pick') await view.executeJavaScript('window.__novaE2E.pick(true)')
      else await view.executeJavaScript('window.__novaE2E.stop()')
    } catch (err) {
      useStore.getState().notify(`Could not attach the recorder: ${(err as Error).message}`, 'error')
      return
    }
    setRecording(next === 'record')
    setPicking(next === 'pick')
    if (next === 'record') {
      setActions([{ type: 'navigate', url: view.getURL(), at: Date.now() }])
      setInspected(null)
    }
  }, [])

  /** Writes the recording out as a Playwright spec beside the project. */
  const saveScript = useCallback(async () => {
    if (!root) return
    const tidied = tidy(actions)
    const source = toPlaywright(tidied, { title: 'records a user flow', baseUrl: originOf(currentUrl) })
    const file = `${root}/e2e/recorded-${Date.now()}.spec.ts`
    try {
      await window.nova.fs.create(file, false)
      await window.nova.fs.write(file, source)
      await useStore.getState().openFile(file)
      useStore.getState().notify(`Wrote ${tidied.length} steps to ${file}`, 'info')
    } catch (err) {
      useStore.getState().notify(`Could not write the spec: ${(err as Error).message}`, 'error')
    }
  }, [actions, currentUrl, root])

  /** Captures the page and compares it with its stored baseline. */
  const compareVisual = useCallback(async () => {
    const view = viewRef.current
    if (!view || !root) return
    // A hidden webview produces no frames, so the capture would wait out its
    // timeout and then report something misleading. Saying so straight away
    // is both faster and true.
    const box = view.getBoundingClientRect()
    if (box.width < 2 || box.height < 2) {
      setVisual('the page has to be visible to capture it')
      return
    }

    setVisual('comparing…')
    try {
      const name = new URL(view.getURL()).pathname.replace(/\//g, '-') || 'index'
      const result = await window.nova.e2e.compareScreenshot(root, name, view.getWebContentsId())
      setVisual(
        result.error
          ? result.error
          : result.created
            ? 'baseline captured'
            : result.matched
              ? `matches (${result.changedPixels} px)`
              : `${result.changedPixels} px changed (${(result.ratio * 100).toFixed(2)}%)`,
      )
    } catch (err) {
      setVisual((err as Error).message)
    }
  }, [root])

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

    /**
     * The recorder reports over `console.log` with a prefix, because a webview
     * is given no preload and so has no message channel back. Every other
     * console line the page writes passes straight through.
     */
    const onConsole = (e: Event) => {
      // Nothing is listened for unless a recording or a pick is actually in
      // progress. The recorder used to accept messages whenever the pane was
      // open, so a page could add steps to a test the user was not recording.
      const { recording: isRecording, picking: isPicking } = modeRef.current
      if (!isRecording && !isPicking) return

      const message = (e as unknown as { message: string }).message ?? ''
      if (!message.includes(channelRef.current)) return
      const payload = parseMessage(message, channelRef.current)
      if (!payload) return
      handleRecorderMessage(payload)
    }

    /**
     * Re-injected on every load: the script lives in the page, and a page load
     * throws it away. It removes its own listeners first, so a re-injection
     * into a surviving document does not double up.
     */
    const onLoaded = () => {
      const { recording: isRecording, picking: isPicking } = modeRef.current
      if (!isRecording && !isPicking) return
      void view
        .executeJavaScript(recorderSource(channelRef.current))
        .then(() =>
          view.executeJavaScript(
            isPicking ? 'window.__novaE2E.pick(true)' : 'window.__novaE2E.start()',
          ),
        )
        .catch(() => undefined)
      if (isRecording) {
        setActions((current) => [...current, { type: 'navigate', url: view.getURL(), at: Date.now() }])
      }
    }

    view.addEventListener('console-message', onConsole)
    view.addEventListener('dom-ready', onLoaded)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('did-navigate', onNavigate)
    view.addEventListener('did-navigate-in-page', onNavigate)
    view.addEventListener('page-title-updated', onTitle)
    view.addEventListener('did-fail-load', onFail)

    return () => {
      view.removeEventListener('console-message', onConsole)
      view.removeEventListener('dom-ready', onLoaded)
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

        <button
          className={`icon-btn ${recording ? 'active' : ''}`}
          title={recording ? 'Stop recording' : 'Record what you do here as a Playwright test'}
          onClick={() => void setMode(recording ? 'off' : 'record')}
        >
          {recording ? <Square size={13} /> : <Circle size={13} />}
        </button>
        <button
          className={`icon-btn ${picking ? 'active' : ''}`}
          title="Point at an element to see the selector a test should use for it"
          onClick={() => void setMode(picking ? 'off' : 'pick')}
        >
          <Crosshair size={14} />
        </button>
        <button
          className="icon-btn"
          title="Save the recording as a Playwright spec"
          onClick={() => void saveScript()}
          disabled={!actions.length || !root}
        >
          <Save size={14} />
        </button>
        <button
          className="icon-btn"
          title="Compare this page with its stored baseline image"
          onClick={() => void compareVisual()}
          disabled={!root}
        >
          <Camera size={14} />
        </button>

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

      {(recording || picking || actions.length > 0 || visual) && (
        <div className="browser-record-bar">
          {recording && <span className="browser-record-dot" />}
          <span className="faint">
            {recording
              ? `Recording — ${actions.length} step${actions.length === 1 ? '' : 's'}`
              : picking
                ? 'Pick an element'
                : `${actions.length} recorded step${actions.length === 1 ? '' : 's'}`}
          </span>
          {inspected && (
            <span className="mono browser-locator" title={`${inspected.kind}${inspected.unique ? '' : ' — matches more than one element'}`}>
              {describeLocator(inspected)}
            </span>
          )}
          {visual && <span className="faint">{visual}</span>}
          {actions.length > 0 && !recording && (
            <button className="link-btn" title="Throw the recording away" onClick={() => setActions([])}>
              Clear
            </button>
          )}
        </div>
      )}

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

/** A one-line rendering of a locator, for the inspector strip. */
function describeLocator(locator: Locator): string {
  const name = locator.name ? ` "${locator.name}"` : ''
  const suffix = locator.unique ? '' : ' (×many)'
  return `${locator.kind}: ${locator.value}${name}${suffix}`
}

/** The origin of a URL, so generated navigations are relative to a baseURL. */
function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}
