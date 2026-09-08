/**
 * End-to-end testing support in the main process.
 *
 * Only the parts that need to touch disk live here. The recorder itself runs
 * inside the browser pane and never leaves the renderer, because the thing it
 * reasons about — the page's DOM — is not reachable from here.
 *
 * Baselines are stored in the project rather than in application data. A
 * screenshot that says "this is what the page should look like" is a reviewable
 * artefact: it belongs next to the code, in the same commit as the change that
 * altered it, where someone can see it in a diff.
 */
import { ipcMain, webContents } from 'electron'
import path from 'node:path'
import type { VisualComparison } from '../../shared/e2e'
import { acceptBaseline, compareToBaseline } from '../lib/visualDiff'

/**
 * Captures through the guest's own debugger, which is the only route that
 * actually works here — and the two obvious alternatives both fail silently,
 * which is worth recording so neither is tried again:
 *
 *   - `<webview>.capturePage()` and `contents.capturePage()` never settle. The
 *     guest's compositor produces no frames on its own, so the promise waits
 *     forever with no error.
 *   - Capturing the host window and cropping to the pane returns the chrome
 *     with a blank hole where the guest is: a webview composites separately
 *     and is not part of the window's surface.
 *
 * `Page.captureScreenshot` forces a frame, which is the part the others are
 * missing. It also means the PNG never crosses the IPC boundary.
 */

/** Where baselines live, relative to the project root. */
const BASELINE_DIR = path.join('e2e', '__screenshots__')

export function registerE2eHandlers() {
  ipcMain.handle(
    'e2e:compareScreenshot',
    async (_e, root: string, name: string, contentsId: number): Promise<VisualComparison> => {
      const blank = (error: string): VisualComparison => ({
        name,
        created: false,
        matched: false,
        changedPixels: 0,
        totalPixels: 0,
        ratio: 1,
        error,
      })
      if (!root) return blank('Open a project before capturing a baseline.')

      const png = await capture(contentsId)
      if (!png) {
        return blank(
          'Could not capture the page. It has to be visible, and DevTools must not be open on it.',
        )
      }
      return compareToBaseline(name, png, path.join(root, BASELINE_DIR))
    },
  )

  ipcMain.handle(
    'e2e:acceptScreenshot',
    async (_e, root: string, name: string, contentsId: number): Promise<boolean> => {
      if (!root) return false
      const png = await capture(contentsId)
      if (!png) return false
      await acceptBaseline(name, png, path.join(root, BASELINE_DIR))
      return true
    },
  )
}

/**
 * Grabs one screencast frame.
 *
 * `Page.captureScreenshot` waits for the compositor to hand it a frame, and an
 * unfocused or occluded guest never produces one — so it hangs. Starting a
 * screencast *asks* for frames rather than waiting for one to happen, which is
 * what makes a capture possible at all.
 *
 * It does not make the guest independent of the compositor: a fully occluded
 * window still produces no frames, and the capture times out into the "could
 * not capture" message. The pane has to be on screen. That is a platform
 * constraint, not something this can work around.
 */
function screencastFrame(contents: Electron.WebContents): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false

    const onMessage = (_event: unknown, method: string, params: Record<string, unknown>) => {
      if (method !== 'Page.screencastFrame' || settled) return
      settled = true
      contents.debugger.off('message', onMessage)

      // The frame must be acknowledged or the stream stalls, even though this
      // one is the only frame being taken.
      void contents.debugger
        .sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId })
        .catch(() => undefined)
      void contents.debugger.sendCommand('Page.stopScreencast').catch(() => undefined)

      resolve(Buffer.from(String(params.data ?? ''), 'base64'))
    }

    contents.debugger.on('message', onMessage)
    contents.debugger
      .sendCommand('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
      .catch(() => {
        if (settled) return
        settled = true
        contents.debugger.off('message', onMessage)
        resolve(null)
      })
  })
}

/**
 * A capture of the guest page, or null.
 *
 * Bounded rather than awaited indefinitely: a promise that never settles looks
 * to the user exactly like the feature being broken, and "could not capture"
 * is at least actionable.
 */
export async function capture(contentsId: number): Promise<Buffer | null> {
  const contents = webContents.fromId(contentsId)
  if (!contents || contents.isDestroyed()) return null

  // The debugger is exclusive: DevTools on the same contents already holds it.
  let attached = false
  try {
    if (!contents.debugger.isAttached()) {
      contents.debugger.attach('1.3')
      attached = true
    }
  } catch {
    return null
  }

  try {
    await contents.debugger.sendCommand('Page.enable').catch(() => undefined)

    const png = await Promise.race([
      screencastFrame(contents),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ])
    return png?.length ? png : null
  } catch {
    return null
  } finally {
    // Only detach what this call attached; leaving a debugger session open
    // would stop DevTools from ever being usable on that page again.
    if (attached) {
      try {
        contents.debugger.detach()
      } catch {
        /* already gone */
      }
    }
  }
}
