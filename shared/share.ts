/**
 * Sharing a session over a Cloudflare tunnel.
 *
 * Two things can be shared and they are deliberately separate: the project as
 * a live read-only view, and a request collection as a browsable page. Someone
 * being sent an API collection should not thereby receive the whole source
 * tree.
 *
 * A live share can also carry audio and video — a screen, a camera, a
 * microphone, or any combination — so a walkthrough does not need a second
 * tool. That travels down the same tunnel as everything else, and it is just as
 * one-directional: a viewer receives, and has no way to send anything back.
 *
 * Everything served is read-only. There is no write path, by construction
 * rather than by permission check — the share server has no endpoint that
 * mutates anything.
 */

export type ShareMode = 'project' | 'collection'

export interface ShareOptions {
  mode: ShareMode
  /** For `collection` mode: the `.http` file to publish. */
  file?: string
  /** Whether a viewer follows the editor's active file as it changes. */
  follow: boolean
}

/**
 * What a broadcaster is sending. Each is independent: a voice-only walkthrough
 * of a shared project is as valid as a silent screen, so nothing here implies
 * anything else.
 */
export interface ShareBroadcastSelection {
  screen: boolean
  camera: boolean
  microphone: boolean
  /** Which display or window to send, from `share:screenSources`. */
  screenSourceId?: string
}

/**
 * The two media channels a viewer can receive.
 *
 * `main` is whatever the presenter chose as the subject — the screen if one is
 * being sent, otherwise the camera. `camera` exists only to carry the presenter
 * alongside a screen, which is the one case where a single channel cannot hold
 * both. Splitting them this way means a viewer with no camera feed is not
 * paying for a composite that is mostly dead pixels.
 */
export type ShareMediaChannel = 'main' | 'camera'

export interface ShareBroadcastStatus {
  active: boolean
  screen: boolean
  camera: boolean
  microphone: boolean
  startedAt: number
  /** Set when capture failed — a denied permission, usually. */
  error?: string
}

/**
 * The exact media type for a channel carrying these tracks.
 *
 * Both ends have to name the same string: the presenter asks `MediaRecorder`
 * for it, and the viewer's `SourceBuffer` is created with it. A mismatch — a
 * buffer expecting Opus on a stream that carries no audio, say — fails at the
 * first append with nothing on screen to explain why, so the two sides derive
 * it from the same function rather than each spelling it out.
 */
export function shareMediaMime(hasVideo: boolean, hasAudio: boolean): string {
  if (hasVideo && hasAudio) return 'video/webm; codecs="vp8,opus"'
  if (hasVideo) return 'video/webm; codecs="vp8"'
  return 'audio/webm; codecs="opus"'
}

/** A screen or window the presenter can choose to send. */
export interface ShareScreenSource {
  id: string
  name: string
  /** data: URL of a still, so the picker shows what it is offering. */
  thumbnail: string
  kind: 'screen' | 'window'
}

export type ShareState = 'stopped' | 'starting' | 'live' | 'error'

export interface ShareStatus {
  state: ShareState
  mode: ShareMode
  /** The public URL, once the tunnel has one. Empty until then. */
  url: string
  /** The loopback address the tunnel points at. */
  localUrl: string
  /** What is being shared, in one line, for the UI to display back. */
  sharing: string
  /** Viewers currently connected to the live stream. */
  viewers: number
  startedAt: number
  error?: string
  /** Paths deliberately withheld — env files, keys — so the user can see. */
  excluded: string[]
  /** Live audio/video riding the same tunnel, if any. */
  broadcast: ShareBroadcastStatus
}

/** What the renderer pushes so viewers see the editor move. */
export interface SharePresence {
  /** Path relative to the project root. */
  activeFile: string
  /** Contents of the active file, when it is a text file within the limit. */
  content?: string
  line?: number
}
