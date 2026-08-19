/**
 * Capturing what the presenter chose to send.
 *
 * This is the renderer half of a live share: it opens the media streams, hands
 * them to a `MediaRecorder`, and pushes each encoded chunk over IPC. The main
 * process owns the fan-out to viewers; nothing here knows or cares who is
 * watching.
 *
 * Two channels rather than one composite. When a screen and a camera are both
 * being sent, compositing them into a single frame would mean a canvas, a
 * render loop and a layout decision made here that the viewer cannot undo. Two
 * streams cost a second encoder and let the viewer's page place the camera
 * where it likes.
 */
import {
  shareMediaMime,
  type ShareBroadcastSelection,
  type ShareMediaChannel,
} from '@shared/share'

/** How often the recorder emits. Short enough to feel live, long enough that
 *  the per-chunk overhead across IPC stays irrelevant. */
const CHUNK_MS = 1000

export interface BroadcastHandle {
  /** Everything opened, so the caller can preview it locally. */
  streams: { main?: MediaStream; camera?: MediaStream }
  stop: () => void
}

/**
 * The legacy Chromium constraint shape for a desktop source. Electron still
 * accepts it and it is the only route that takes a source id chosen in our own
 * UI — `getDisplayMedia` would put Chromium's picker in front of the user
 * instead, after they already picked.
 */
interface DesktopConstraint {
  mandatory: { chromeMediaSource: 'desktop'; chromeMediaSourceId: string }
}

export async function startBroadcast(selection: ShareBroadcastSelection): Promise<BroadcastHandle> {
  if (!selection.screen && !selection.camera && !selection.microphone) {
    throw new Error('Choose at least one of screen, camera or microphone.')
  }

  const opened: MediaStream[] = []
  const recorders: MediaRecorder[] = []

  /** Releases every device this call took, whatever order things failed in. */
  const releaseAll = () => {
    for (const recorder of recorders) {
      try {
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* already stopped */
      }
    }
    for (const stream of opened) {
      for (const track of stream.getTracks()) track.stop()
    }
  }

  try {
    let screenStream: MediaStream | undefined
    let cameraStream: MediaStream | undefined
    let micStream: MediaStream | undefined

    if (selection.screen) {
      if (!selection.screenSourceId) throw new Error('Pick a screen or window to share.')
      screenStream = await navigator.mediaDevices.getUserMedia({
        // Cast: the desktop constraint is Chromium-specific and outside the
        // standard MediaTrackConstraints type.
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: selection.screenSourceId,
          },
        } as unknown as MediaTrackConstraints,
      })
      opened.push(screenStream)
    }

    if (selection.camera) {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      opened.push(cameraStream)
    }

    if (selection.microphone) {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      opened.push(micStream)
    }

    // The screen is the subject when there is one; otherwise the camera is.
    const mainVideo = screenStream ?? (selection.screen ? undefined : cameraStream)
    const main = new MediaStream()
    for (const track of mainVideo?.getVideoTracks() ?? []) main.addTrack(track)
    for (const track of micStream?.getAudioTracks() ?? []) main.addTrack(track)

    recorders.push(
      record('main', main, shareMediaMime(main.getVideoTracks().length > 0, Boolean(micStream))),
    )

    // A camera only needs its own channel when the screen has taken the main one.
    let cameraOnly: MediaStream | undefined
    if (screenStream && cameraStream) {
      cameraOnly = new MediaStream(cameraStream.getVideoTracks())
      recorders.push(record('camera', cameraOnly, shareMediaMime(true, false)))
    }

    // A screen share ended from the OS's own "stop sharing" affordance arrives
    // as the track simply ending, which the caller has to hear about — the
    // alternative is a share the user believes they stopped and did not.
    return {
      streams: { main, camera: cameraOnly },
      stop: releaseAll,
    }
  } catch (err) {
    releaseAll()
    throw err instanceof Error ? err : new Error(String(err))
  }

  function record(channel: ShareMediaChannel, stream: MediaStream, mime: string): MediaRecorder {
    if (!MediaRecorder.isTypeSupported(mime)) {
      throw new Error(`This machine cannot encode ${mime}.`)
    }
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 })

    // `Blob.arrayBuffer()` is asynchronous, so firing one per chunk lets a later
    // chunk overtake an earlier one — and the very first chunk carries the
    // header the whole stream is decoded against. Losing that race means the
    // server keeps a mid-stream cluster as the header and every viewer who
    // joins afterwards is sent something their player cannot open. Chaining the
    // conversions keeps them in the order the recorder produced them.
    let tail: Promise<void> = Promise.resolve()
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return
      tail = tail
        .then(async () => {
          window.nova.share.media(channel, await event.data.arrayBuffer())
        })
        .catch(() => undefined)
    }

    recorder.start(CHUNK_MS)
    return recorder
  }
}
