/**
 * Android emulators and iOS simulators, mirrored beside the code.
 *
 * The problem this solves is window shuffling, not capability: the emulator
 * already runs, it just lives in another application that has to be found and
 * raised. Mirroring it into a pane removes that, and makes the device
 * addressable from the same window as the project it is running.
 *
 * A click in the pane becomes a tap on the device. The conversion happens here
 * rather than in the main process because only the renderer knows how large the
 * pane is — the frame carries the device's own pixel dimensions, and the ratio
 * between the two is the scale factor.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Loader2,
  Play,
  RefreshCw,
  ScrollText,
  Smartphone,
  Square,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import type {
  DeviceCapabilities,
  DeviceFrame,
  DeviceLogLine,
  DeviceToolStatus,
  MobileDevice,
} from '@shared/devices'

export default function DevicesView() {
  const [status, setStatus] = useState<DeviceToolStatus[]>([])
  const [devices, setDevices] = useState<MobileDevice[]>([])
  const [selected, setSelected] = useState<MobileDevice | null>(null)
  const [capabilities, setCapabilities] = useState<DeviceCapabilities | null>(null)
  const [frame, setFrame] = useState<DeviceFrame | null>(null)
  const [logLines, setLogLines] = useState<DeviceLogLine[]>([])
  const [showLogs, setShowLogs] = useState(false)
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const screenRef = useRef<HTMLImageElement>(null)
  const dragFrom = useRef<{ x: number; y: number } | null>(null)

  const refresh = useCallback(async () => {
    const [tools, list] = await Promise.all([
      window.nova.devices.status(),
      window.nova.devices.list(),
    ])
    setStatus(tools)
    setDevices(list)
    // Keep the selection pointing at the same device across refreshes, and
    // follow its state — an AVD that has finished booting gets a new id.
    setSelected((current) => {
      if (!current) return null
      return (
        list.find((d) => d.id === current.id) ??
        list.find((d) => d.avd && d.avd === current.avd) ??
        null
      )
    })
  }, [])

  useEffect(() => {
    void refresh()
    // Devices appear and disappear outside Nova, so a list from a minute ago is
    // worse than none. Cheap enough to poll.
    const timer = setInterval(() => void refresh(), 4000)
    return () => clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const offFrame = window.nova.devices.onFrame((f) => {
      setFrame((current) => (current && current.deviceId !== f.deviceId ? current : f))
    })
    const offLog = window.nova.devices.onLog((line) =>
      // Bounded: logcat on a busy device produces thousands of lines a minute,
      // and a list that only grows takes the panel down with it.
      setLogLines((lines) => [...lines.slice(-400), line]),
    )
    return () => {
      offFrame()
      offLog()
    }
  }, [])

  /** Stop mirroring when the panel goes away, or the device stream leaks. */
  useEffect(
    () => () => {
      if (selected) {
        void window.nova.devices.stopMirror(selected.id)
        void window.nova.devices.stopLogs(selected.id)
      }
    },
    [selected],
  )

  const select = async (device: MobileDevice) => {
    if (selected && selected.id !== device.id) {
      await window.nova.devices.stopMirror(selected.id)
      await window.nova.devices.stopLogs(selected.id)
    }
    setSelected(device)
    setFrame(null)
    setLogLines([])
    setCapabilities(await window.nova.devices.capabilities(device.platform))
    if (device.state === 'booted') await window.nova.devices.startMirror(device)
  }

  const boot = async (device: MobileDevice) => {
    setBusy(device.id)
    setNote('')
    const result = await window.nova.devices.boot(device)
    if (!result.ok) setNote(result.error ?? 'The device would not start.')
    setBusy('')
    // Booting takes a while and the id changes when it attaches to adb, so the
    // poll picks it up rather than this call trying to predict it.
    setTimeout(() => void refresh(), 3000)
  }

  const stop = async (device: MobileDevice) => {
    setBusy(device.id)
    await window.nova.devices.shutdown(device)
    setFrame(null)
    setBusy('')
    void refresh()
  }

  const install = async () => {
    if (!selected) return
    const file = await window.nova.app.openFileDialog({
      filters: [{ name: selected.platform === 'android' ? 'Android package' : 'iOS app', extensions: selected.platform === 'android' ? ['apk'] : ['app', 'ipa'] }],
    })
    if (!file) return
    setBusy(selected.id)
    const result = await window.nova.devices.install(selected, file)
    setNote(result.output)
    setBusy('')
  }

  const toggleLogs = async () => {
    if (!selected) return
    if (showLogs) {
      await window.nova.devices.stopLogs(selected.id)
      setShowLogs(false)
      return
    }
    const started = await window.nova.devices.startLogs(selected)
    setShowLogs(started)
    if (!started) setNote(capabilities?.note ?? 'This platform has no device log Nova can read.')
  }

  /** Turns a point in the pane into a point on the device. */
  const toDevice = (event: React.MouseEvent) => {
    const img = screenRef.current
    if (!img || !frame?.width) return null
    const box = img.getBoundingClientRect()
    return {
      x: ((event.clientX - box.left) / box.width) * frame.width,
      y: ((event.clientY - box.top) / box.height) * frame.height,
    }
  }

  const onMouseDown = (event: React.MouseEvent) => {
    dragFrom.current = toDevice(event)
  }

  const onMouseUp = async (event: React.MouseEvent) => {
    if (!selected || !capabilities?.input) return
    const from = dragFrom.current
    const to = toDevice(event)
    dragFrom.current = null
    if (!from || !to) return

    // A drag of a few pixels is a tap that moved, not a swipe. Sending it as a
    // swipe makes buttons unpressable.
    const distance = Math.hypot(to.x - from.x, to.y - from.y)
    await window.nova.devices.input(
      selected,
      distance < 12
        ? { kind: 'tap', x: to.x, y: to.y }
        : { kind: 'swipe', x: from.x, y: from.y, toX: to.x, toY: to.y, durationMs: 220 },
    )
  }

  const onKeyDown = async (event: React.KeyboardEvent) => {
    if (!selected || !capabilities?.input) return
    if (event.key === 'Enter') await window.nova.devices.input(selected, { kind: 'key', key: 'enter' })
    else if (event.key === 'Backspace') await window.nova.devices.input(selected, { kind: 'key', key: 'delete' })
    else if (event.key.length === 1) await window.nova.devices.input(selected, { kind: 'text', text: event.key })
    else return
    event.preventDefault()
  }

  const unavailable = status.filter((s) => !s.available)

  return (
    <div className="devices-view">
      <div className="panel-toolbar">
        <button className="btn sm" title="Look for emulators and simulators again" onClick={() => void refresh()}>
          <RefreshCw size={12} /> Refresh
        </button>
        {selected && selected.state === 'booted' && (
          <>
            <button className="btn sm" title="Install an app package on this device" onClick={() => void install()}>
              <Upload size={12} /> Install
            </button>
            <button
              className={`btn sm ${showLogs ? 'active' : ''}`}
              title={capabilities?.logs ? 'Stream the device log' : 'This platform has no device log Nova can read'}
              disabled={!capabilities?.logs}
              onClick={() => void toggleLogs()}
            >
              <ScrollText size={12} /> Logs
            </button>
          </>
        )}
        <span className="faint" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {devices.length} device{devices.length === 1 ? '' : 's'}
        </span>
      </div>

      {unavailable.map((tool) => (
        <div key={tool.platform} className="devices-warn">
          <TriangleAlert size={12} />
          <span>
            <strong>{tool.platform === 'android' ? 'Android' : 'iOS'}:</strong> {tool.detail}
          </span>
        </div>
      ))}

      <div className="devices-body">
        <div className="devices-list">
          {!devices.length && (
            <p className="faint" style={{ padding: 10, fontSize: 11, lineHeight: 1.6 }}>
              No emulators found. Create one in Android Studio › Device Manager, or a simulator in
              Xcode › Window › Devices and Simulators.
            </p>
          )}
          {devices.map((device) => (
            <div
              key={device.id}
              className={`device-row ${selected?.id === device.id ? 'active' : ''}`}
              onClick={() => void select(device)}
            >
              <Smartphone size={13} className={device.platform === 'android' ? 'android' : 'ios'} />
              <div className="device-name">
                <span>{device.name}</span>
                <span className="faint">
                  {device.platform === 'android' ? 'Android' : 'iOS'}
                  {device.api ? ` · ${device.api}` : ''}
                </span>
              </div>
              <span className={`chip device-state ${device.state}`}>{device.state}</span>
              {device.state === 'shutdown' ? (
                <button
                  className="icon-btn"
                  title={`Start ${device.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void boot(device)
                  }}
                >
                  {busy === device.id ? <Loader2 size={12} className="spin" /> : <Play size={12} />}
                </button>
              ) : (
                <button
                  className="icon-btn"
                  title={`Shut down ${device.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    void stop(device)
                  }}
                >
                  {busy === device.id ? <Loader2 size={12} className="spin" /> : <Square size={11} />}
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="device-screen-pane">
          {!selected && <p className="faint device-hint">Pick a device to mirror it here.</p>}

          {selected && selected.state !== 'booted' && (
            <p className="faint device-hint">
              {selected.state === 'booting'
                ? `${selected.name} is starting…`
                : `${selected.name} is not running. Press ▶ to start it.`}
            </p>
          )}

          {selected && selected.state === 'booted' && (
            <>
              {frame?.image ? (
                <img
                  ref={screenRef}
                  className={`device-screen ${capabilities?.input ? 'interactive' : ''}`}
                  src={frame.image}
                  alt={`${selected.name} screen`}
                  title={
                    capabilities?.input
                      ? 'Click to tap, drag to swipe, type to send text'
                      : capabilities?.note
                    }
                  tabIndex={0}
                  onMouseDown={onMouseDown}
                  onMouseUp={(e) => void onMouseUp(e)}
                  onKeyDown={(e) => void onKeyDown(e)}
                  draggable={false}
                />
              ) : (
                <p className="faint device-hint">
                  <Loader2 size={13} className="spin" /> Waiting for a frame…
                  {frame?.error ? ` ${frame.error}` : ''}
                </p>
              )}
            </>
          )}

          {showLogs && (
            <pre className="device-logs">
              {logLines.map((line, i) => (
                <div key={i}>{line.text}</div>
              ))}
            </pre>
          )}
        </div>
      </div>

      {note && (
        <div className="devices-note">
          <pre>{note}</pre>
        </div>
      )}
    </div>
  )
}
