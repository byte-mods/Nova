/**
 * Starting a share, and seeing exactly what it exposes.
 *
 * The design problem here is not the tunnel — it is making the consequence
 * obvious. A public URL is a public URL, so the dialog says what is being
 * shared, lists what was deliberately withheld, shows how many people are
 * looking, and keeps Stop in front of the user the whole time.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Globe,
  Loader2,
  Mic,
  Monitor,
  Radio,
  RefreshCw,
  Square,
  Video,
  X,
} from 'lucide-react'
import { useStore } from '@/state/store'
import { startBroadcast, type BroadcastHandle } from '@/lib/shareBroadcast'
import type { ShareMode, ShareScreenSource, ShareStatus } from '@shared/share'

export default function ShareDialog({ onClose }: { onClose: () => void }) {
  const root = useStore((s) => s.root)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  const [status, setStatus] = useState<ShareStatus | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [mode, setMode] = useState<ShareMode>('project')
  const [copied, setCopied] = useState(false)

  const [screen, setScreen] = useState(false)
  const [camera, setCamera] = useState(false)
  const [microphone, setMicrophone] = useState(false)
  const [sources, setSources] = useState<ShareScreenSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [castError, setCastError] = useState('')
  const [busy, setBusy] = useState(false)
  const cast = useRef<BroadcastHandle | null>(null)
  const preview = useRef<HTMLVideoElement | null>(null)

  const active = tabs.find((t) => t.id === activeTabId)
  const collectionFile =
    active?.path && /\.(http|rest)$/i.test(active.path) ? active.path : undefined

  useEffect(() => {
    void window.nova.share.available().then(setAvailable)
    void window.nova.share.status().then(setStatus)
    return window.nova.share.onStatus(setStatus)
  }, [])

  const start = useCallback(async () => {
    if (!root) return
    setCopied(false)
    await window.nova.share.start(root, {
      mode,
      file: mode === 'collection' ? collectionFile : undefined,
      follow: true,
    })
  }, [root, mode, collectionFile])

  /* ---------------- live audio and video ---------------- */

  const live = status?.state === 'live'
  const starting = status?.state === 'starting'
  const casting = status?.broadcast.active ?? false

  const loadSources = useCallback(async () => {
    const list = await window.nova.share.screenSources()
    setSources(list)
    setSourceId((current) => (list.some((s) => s.id === current) ? current : (list[0]?.id ?? '')))
  }, [])

  const stopCast = useCallback(async () => {
    cast.current?.stop()
    cast.current = null
    if (preview.current) preview.current.srcObject = null
    await window.nova.share.broadcast(null)
  }, [])

  const startCast = useCallback(async () => {
    setCastError('')
    setBusy(true)
    try {
      // A recorder starting again must not have the previous stream's header
      // handed to the next viewer, or their player reads new clusters against
      // an old timeline.
      await window.nova.share.mediaReset('main')
      await window.nova.share.mediaReset('camera')

      // Announced before capture starts, not after: the server drops media that
      // arrives while no broadcast is declared, and the first chunk a recorder
      // produces is the header the whole stream is decoded against.
      await window.nova.share.broadcast({ screen, camera, microphone, screenSourceId: sourceId })

      const handle = await startBroadcast({ screen, camera, microphone, screenSourceId: sourceId })
      cast.current = handle
      if (preview.current) preview.current.srcObject = handle.streams.main ?? null
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCastError(
        /Permission|NotAllowed/i.test(message)
          ? 'Permission was refused. macOS asks per app under System Settings › Privacy & Security.'
          : message,
      )
      cast.current?.stop()
      cast.current = null
      await window.nova.share.broadcast(null, message)
    } finally {
      setBusy(false)
    }
  }, [screen, camera, microphone, sourceId])

  // Whatever ends the share ends the capture: leaving a camera light on after
  // the tunnel closed would be the worst possible failure here.
  useEffect(() => {
    if (!live && cast.current) void stopCast()
  }, [live, stopCast])

  useEffect(() => () => cast.current?.stop(), [])

  useEffect(() => {
    if (screen && !sources.length) void loadSources()
  }, [screen, sources.length, loadSources])

  const stop = useCallback(async () => {
    setCopied(false)
    await stopCast()
    await window.nova.share.stop()
  }, [stopCast])

  const copy = useCallback(async () => {
    if (!status?.url) return
    await navigator.clipboard.writeText(status.url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [status])

  return (
    <div className="overlay" style={{ paddingTop: 80 }} onMouseDown={onClose}>
      <div className="modal share-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="share-head">
          <Globe size={14} />
          <strong>Share this session</strong>
          <span style={{ flex: 1 }} />
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {available === false && (
          <div className="share-warn">
            <AlertTriangle size={13} />
            <div>
              <strong>cloudflared is not installed.</strong> It opens the tunnel that gives the
              share a public address.
              <br />
              <code className="mono">brew install cloudflared</code>
            </div>
          </div>
        )}

        {!live && !starting && (
          <>
            <div className="share-modes">
              <label className={mode === 'project' ? 'active' : ''} title="A read-only view of the project, following the file you are looking at">
                <input
                  type="radio"
                  checked={mode === 'project'}
                  onChange={() => setMode('project')}
                />
                <div>
                  <strong>The project</strong>
                  <span>
                    A read-only view that follows the file you have open. Viewers can browse the
                    tree; they cannot change anything.
                  </span>
                </div>
              </label>

              <label
                className={`${mode === 'collection' ? 'active' : ''} ${collectionFile ? '' : 'disabled'}`}
                title={
                  collectionFile
                    ? 'Publish this request collection as a browsable page'
                    : 'Open a .http file to share it as a collection'
                }
              >
                <input
                  type="radio"
                  checked={mode === 'collection'}
                  disabled={!collectionFile}
                  onChange={() => setMode('collection')}
                />
                <div>
                  <strong>A request collection</strong>
                  <span>
                    {collectionFile
                      ? `Publish ${collectionFile.split('/').pop()} — requests, methods and bodies, with credentials masked. The source tree is not shared.`
                      : 'Open a .http file to share it on its own.'}
                  </span>
                </div>
              </label>
            </div>

            <div className="share-note">
              <AlertTriangle size={12} />
              Anyone with the link can read what is shared. The address is unguessable, but it is
              public — send it to people, not to a channel that logs URLs.
            </div>

            <div className="share-actions">
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => void start()}
                disabled={!root || available === false}
                title="Open a Cloudflare tunnel and give this session a public address"
              >
                <Radio size={12} /> Start sharing
              </button>
            </div>
          </>
        )}

        {starting && (
          <div className="share-starting">
            <Loader2 size={14} className="spin" />
            <span>Opening a tunnel…</span>
            <span className="faint">
              The local server is up at {status?.localUrl ? new URL(status.localUrl).host : '…'};
              Cloudflare is assigning an address.
            </span>
          </div>
        )}

        {live && status && (
          <>
            <div className="share-live">
              <span className="share-dot" />
              <span>
                Sharing <strong>{status.sharing}</strong>
              </span>
              <span className="faint">
                {status.viewers} viewer{status.viewers === 1 ? '' : 's'}
              </span>
            </div>

            <div className="share-url">
              <input readOnly value={status.url} onFocus={(e) => e.currentTarget.select()} />
              <button className="btn sm" onClick={() => void copy()} title="Copy the link to the clipboard">
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                className="btn sm"
                onClick={() => void window.nova.app.openExternal(status.url)}
                title="Open the shared view in your own browser"
              >
                Open
              </button>
            </div>

            <div className="share-cast">
              <div className="share-cast-head">
                <Radio size={12} />
                <strong>Live audio &amp; video</strong>
                <span className="faint">
                  {casting ? 'viewers are watching this now' : 'optional — pick what to send'}
                </span>
              </div>

              <div className="share-cast-picks">
                <label
                  className={screen ? 'active' : ''}
                  title="Send a screen or a single window to everyone with the link"
                >
                  <input
                    type="checkbox"
                    checked={screen}
                    disabled={casting}
                    onChange={(e) => setScreen(e.target.checked)}
                  />
                  <Monitor size={13} /> Screen
                </label>
                <label
                  className={camera ? 'active' : ''}
                  title="Send your camera. Alongside a screen it appears as a small inset for viewers"
                >
                  <input
                    type="checkbox"
                    checked={camera}
                    disabled={casting}
                    onChange={(e) => setCamera(e.target.checked)}
                  />
                  <Video size={13} /> Camera
                </label>
                <label className={microphone ? 'active' : ''} title="Send your microphone">
                  <input
                    type="checkbox"
                    checked={microphone}
                    disabled={casting}
                    onChange={(e) => setMicrophone(e.target.checked)}
                  />
                  <Mic size={13} /> Microphone
                </label>
              </div>

              {screen && !casting && (
                <div className="share-sources">
                  <div className="share-sources-head">
                    <span className="plugin-label">Which screen or window</span>
                    <button
                      className="icon-btn"
                      title="Look for screens and windows again"
                      onClick={() => void loadSources()}
                    >
                      <RefreshCw size={11} />
                    </button>
                  </div>
                  <div className="share-source-grid">
                    {sources.map((s) => (
                      <button
                        key={s.id}
                        className={`share-source ${sourceId === s.id ? 'active' : ''}`}
                        title={s.name}
                        onClick={() => setSourceId(s.id)}
                      >
                        {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <div className="share-source-blank" />}
                        <span>{s.name}</span>
                      </button>
                    ))}
                    {!sources.length && <span className="faint">Looking for screens…</span>}
                  </div>
                </div>
              )}

              {casting && (
                <video
                  ref={preview}
                  className="share-preview"
                  autoPlay
                  playsInline
                  muted
                  title="What viewers are seeing right now"
                />
              )}

              {castError && (
                <div className="share-warn">
                  <AlertTriangle size={13} />
                  <div>{castError}</div>
                </div>
              )}

              <div className="share-cast-actions">
                {!casting ? (
                  <button
                    className="btn primary sm"
                    disabled={(!screen && !camera && !microphone) || busy || (screen && !sourceId)}
                    onClick={() => void startCast()}
                    title="Start sending the selected screen, camera and microphone to viewers"
                  >
                    {busy ? <Loader2 size={12} className="spin" /> : <Radio size={12} />}
                    {busy ? 'Starting…' : 'Go live'}
                  </button>
                ) : (
                  <button
                    className="btn sm danger"
                    onClick={() => void stopCast()}
                    title="Stop sending audio and video — the shared page stays up"
                  >
                    <Square size={11} /> Stop the broadcast
                  </button>
                )}
                <span className="faint" style={{ fontSize: 11 }}>
                  {casting
                    ? 'The camera and microphone stay on until you stop.'
                    : 'Nothing is captured until you press Go live.'}
                </span>
              </div>
            </div>

            {status.excluded.length > 0 && (
              <div className="share-note">
                <AlertTriangle size={12} />
                Withheld from the share: {status.excluded.slice(0, 6).join(', ')}
                {status.excluded.length > 6 ? ` and ${status.excluded.length - 6} more` : ''}
              </div>
            )}

            <div className="share-actions">
              <button className="btn danger" onClick={() => void stop()} title="Close the tunnel — the link stops working immediately">
                <Square size={11} /> Stop sharing
              </button>
            </div>
          </>
        )}

        {status?.state === 'error' && (
          <div className="share-warn">
            <AlertTriangle size={13} />
            <div>{status.error}</div>
          </div>
        )}
      </div>
    </div>
  )
}
