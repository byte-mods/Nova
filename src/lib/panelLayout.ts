/**
 * Fitting the side panels into the window that actually exists.
 *
 * The sidebar and the AI console each remember a width in pixels, and neither
 * remembered width knows anything about the size of the window. Both panels are
 * `flex-shrink: 0`, so when the two of them plus the activity bar came to more
 * than the window was wide, nothing gave way: the editor between them collapsed
 * to nothing and the overflow ran off the edge, where `.app-body`'s
 * `overflow: hidden` clipped it. A console dragged wide on a big monitor, or a
 * window made narrow afterwards, and the editor was simply gone.
 *
 * So the stored width is a preference, not an instruction. It is honoured
 * whenever it fits, and when it does not the panels give up space — down to
 * their own minimums, the same ones the splitters clamp to — before the editor
 * is allowed to disappear.
 */

/** The editor stays at least this wide while there is any room to give it. */
export const MIN_EDITOR_WIDTH = 320

/** Below these a panel is not worth showing; they match the splitter clamps. */
export const MIN_SIDEBAR_WIDTH = 180
export const MIN_AI_WIDTH = 300

export interface PanelFit {
  /** The width to render at, which is at most the width that was asked for. */
  sidebar: number
  ai: number
}

/**
 * `sidebar` and `ai` are the remembered widths, or `null` when that panel is
 * hidden. `available` is the space left for both panels and the editor, after
 * the activity bar and splitters have taken theirs.
 */
export function fitPanels(opts: {
  available: number
  sidebar: number | null
  ai: number | null
}): PanelFit {
  const wanted = { sidebar: opts.sidebar ?? 0, ai: opts.ai ?? 0 }
  const total = wanted.sidebar + wanted.ai
  const room = opts.available - MIN_EDITOR_WIDTH

  // The ordinary case: both fit with the editor's floor left over.
  if (total <= room) return wanted

  const floor = {
    sidebar: opts.sidebar === null ? 0 : MIN_SIDEBAR_WIDTH,
    ai: opts.ai === null ? 0 : MIN_AI_WIDTH,
  }

  // Too small for even the minimums plus an editor. Share what there is, in the
  // proportions asked for, so that everything stays on screen and reachable —
  // the editor is squeezed here, but nothing is clipped away where no amount of
  // scrolling brings it back.
  if (floor.sidebar + floor.ai > room) {
    if (total === 0) return wanted
    const share = Math.max(0, opts.available) / total
    return {
      sidebar: Math.floor(wanted.sidebar * share),
      ai: Math.floor(wanted.ai * share),
    }
  }

  // Give back the overflow in proportion to how much each panel asked for, so
  // the wider one loses more, and stop each at its own minimum.
  const excess = total - room
  const fit = { ...wanted }
  for (const key of ['ai', 'sidebar'] as const) {
    if (!fit[key]) continue
    const shrinkable = fit[key] - floor[key]
    const wants = Math.ceil(excess * (wanted[key] / total))
    fit[key] -= Math.min(shrinkable, wants)
  }

  // Proportional shrinking can leave a little over when one panel hit its
  // minimum first; take the rest from whichever still has room to give.
  let left = fit.sidebar + fit.ai - room
  for (const key of ['ai', 'sidebar'] as const) {
    if (left <= 0) break
    const shrinkable = fit[key] - floor[key]
    const take = Math.min(shrinkable, left)
    fit[key] -= take
    left -= take
  }

  return fit
}
