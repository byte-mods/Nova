/**
 * Fitting the side panels into the window.
 *
 * The bug this covers: both panels remember a pixel width and neither shrinks,
 * so on a narrow window they came to more than the window was wide, the editor
 * between them collapsed, and the overflow was clipped off the screen with no
 * way to scroll it back. What is checked here is the invariant that failed —
 * the panels never add up to more than there is room for — and that a window
 * with plenty of space is left exactly as the user set it.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BUILD } from './env.mjs'

const { fitPanels, MIN_EDITOR_WIDTH, MIN_SIDEBAR_WIDTH, MIN_AI_WIDTH } = await import(
  pathToFileURL(path.join(BUILD, 'panelLayout.js')).href
)

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ---------------- the window is big enough ---------------- */

let fit = fitPanels({ available: 1900, sidebar: 300, ai: 500 })
check('a wide window leaves both widths exactly as set', fit.sidebar === 300 && fit.ai === 500, JSON.stringify(fit))

fit = fitPanels({ available: 1900, sidebar: null, ai: 780 })
check('a hidden sidebar takes no width', fit.sidebar === 0 && fit.ai === 780, JSON.stringify(fit))

// The widest the splitters allow, in a window that can still take them.
fit = fitPanels({ available: 560 + 780 + MIN_EDITOR_WIDTH, sidebar: 560, ai: 780 })
check('the widest allowed panels fit when there is exactly room', fit.sidebar === 560 && fit.ai === 780, JSON.stringify(fit))

/* ---------------- the window is too small ---------------- */

// The reported case: a console dragged wide, then a narrow window.
fit = fitPanels({ available: 900, sidebar: 300, ai: 780 })
check(
  'a narrow window shrinks the panels instead of overflowing',
  fit.sidebar + fit.ai <= 900 - MIN_EDITOR_WIDTH,
  `${fit.sidebar} + ${fit.ai} > ${900 - MIN_EDITOR_WIDTH}`,
)
check('the editor keeps its floor', 900 - fit.sidebar - fit.ai >= MIN_EDITOR_WIDTH, JSON.stringify(fit))
check('neither panel goes below its own minimum', fit.sidebar >= MIN_SIDEBAR_WIDTH && fit.ai >= MIN_AI_WIDTH, JSON.stringify(fit))
check('the panel that asked for more gives up more', 780 - fit.ai >= 300 - fit.sidebar, JSON.stringify(fit))

// Only the console open, and far too wide for the window.
fit = fitPanels({ available: 700, sidebar: null, ai: 780 })
check('a single oversized panel is cut to fit', fit.ai <= 700 - MIN_EDITOR_WIDTH && fit.sidebar === 0, JSON.stringify(fit))

/* ---------------- the window is smaller than the minimums ---------------- */

fit = fitPanels({ available: 500, sidebar: 300, ai: 780 })
check(
  'a window too small for the minimums still keeps everything on screen',
  fit.sidebar + fit.ai <= 500 && fit.sidebar >= 0 && fit.ai >= 0,
  JSON.stringify(fit),
)

fit = fitPanels({ available: 0, sidebar: 300, ai: 500 })
check('a zero-width window produces no negative widths', fit.sidebar >= 0 && fit.ai >= 0, JSON.stringify(fit))

/* ---------------- nothing open ---------------- */

fit = fitPanels({ available: 300, sidebar: null, ai: null })
check('no panels means no widths', fit.sidebar === 0 && fit.ai === 0, JSON.stringify(fit))

/* ---------------- the invariant, swept ---------------- */

let broken = null
for (let available = 0; available <= 2400 && !broken; available += 17) {
  for (const sidebar of [null, MIN_SIDEBAR_WIDTH, 300, 560]) {
    for (const ai of [null, MIN_AI_WIDTH, 500, 780]) {
      const f = fitPanels({ available, sidebar, ai })
      const total = f.sidebar + f.ai
      if (f.sidebar < 0 || f.ai < 0 || total > Math.max(0, available) + 0.001) {
        broken = { available, sidebar, ai, f }
        break
      }
      if (sidebar === null && f.sidebar !== 0) broken = { available, sidebar, ai, f }
      if (ai === null && f.ai !== 0) broken = { available, sidebar, ai, f }
    }
  }
}
check('across every window size, the panels never exceed the window', !broken, JSON.stringify(broken))

console.log(`\ntest-layout: ${pass}/${pass + fail} passed`)
process.exit(fail ? 1 : 0)
