/**
 * The recorder that runs inside the browser pane.
 *
 * It has to execute in the page, not in the renderer — the DOM it reasons
 * about is the page's — and the webview is deliberately given no preload, so
 * there is no message channel to it. The script therefore reports back over
 * `console.log` with a prefix, which the host reads from the webview's
 * `console-message` event. Not elegant, but it needs no privilege granted to
 * the page and cannot be reached by the page's own code by accident.
 *
 * Everything that does not need a DOM — ranking candidates, escaping, the code
 * generator — lives outside the injected string so it can be tested without a
 * browser. What is left inside is the part only a real page can answer.
 */
import type { Locator, LocatorKind } from '@shared/e2e'

/** The prefix a recorder message carries, and the host looks for. */
export const CHANNEL = '__nova_e2e__'

/**
 * Durability order, best first.
 *
 * This is the whole reason a recorder is worth having over hand-written
 * selectors: a test id survives a redesign, a role and an accessible name
 * survive a class rename, and a CSS path survives almost nothing. Ranking is
 * kept out here so the ordering can be tested and argued about without a page.
 */
export const LOCATOR_RANK: LocatorKind[] = [
  'testid',
  'role',
  'label',
  'placeholder',
  'text',
  'id',
  'css',
]

/**
 * Picks the locator a test should use: the most durable one that matched
 * exactly one element. A unique weak locator beats an ambiguous strong one —
 * `.first()` on a role that matched four buttons is a coin toss, while a CSS
 * path that matched one is at least the element the user clicked.
 */
export function bestLocator(candidates: Locator[]): Locator | null {
  if (!candidates.length) return null

  const byRank = [...candidates].sort((a, b) => rank(a) - rank(b))
  const chosen = byRank.find((candidate) => candidate.unique) ?? byRank[0]
  return { ...chosen, alternatives: byRank.filter((candidate) => candidate !== chosen) }
}

/**
 * A role carries its weight only when it has an accessible name.
 * `getByRole('checkbox')` is unique right up until the page grows a second
 * checkbox, and then it silently starts matching the wrong one — so a label or
 * a placeholder, which names the field, is preferred over a bare role.
 */
function rank(locator: Locator): number {
  const base = LOCATOR_RANK.indexOf(locator.kind)
  if (locator.kind === 'role' && !locator.name) return LOCATOR_RANK.indexOf('text') - 0.5
  return base
}

/**
 * The script injected into the page.
 *
 * Written as a string rather than a module because it is evaluated inside the
 * webview through `executeJavaScript`, where nothing from this bundle exists.
 * It is idempotent: re-injecting on every navigation is the only way to
 * survive a page load, so it removes its own listeners first.
 */
export const RECORDER_SOURCE = String.raw`
(() => {
  const CHANNEL = '${CHANNEL}'
  const previous = window.__novaE2E
  if (previous) previous.teardown()

  const state = { recording: false, picking: false }
  const send = (payload) => console.log(CHANNEL + JSON.stringify(payload))

  /* ---------------- locators ---------------- */

  const TEST_ID_ATTRS = ['data-testid', 'data-test-id', 'data-test', 'data-qa']

  /** Implicit ARIA roles for the elements a recorder actually meets. */
  const ROLE_BY_TAG = {
    A: 'link', BUTTON: 'button', SELECT: 'combobox', TEXTAREA: 'textbox',
    H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading',
    H5: 'heading', H6: 'heading', IMG: 'img', NAV: 'navigation',
    TABLE: 'table', UL: 'list', OL: 'list', LI: 'listitem', FORM: 'form',
  }
  const ROLE_BY_INPUT_TYPE = {
    checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button',
    reset: 'button', range: 'slider', number: 'spinbutton', search: 'searchbox',
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role')
    if (explicit) return explicit.trim().split(/\s+/)[0]
    if (el.tagName === 'INPUT') {
      return ROLE_BY_INPUT_TYPE[(el.getAttribute('type') || 'text').toLowerCase()] || 'textbox'
    }
    return ROLE_BY_TAG[el.tagName] || ''
  }

  /** Roughly the accessible name computation, in the order it prefers. */
  function accessibleName(el) {
    const aria = el.getAttribute('aria-label')
    if (aria && aria.trim()) return aria.trim()

    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const parts = labelledBy.split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => (node.textContent || '').trim())
      if (parts.length) return parts.join(' ')
    }

    if (el.tagName === 'IMG') {
      const alt = el.getAttribute('alt')
      if (alt && alt.trim()) return alt.trim()
    }
    if (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type)) {
      if (el.value) return el.value.trim()
    }

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
    // A long run of text is the element's contents, not its name.
    return text.length > 0 && text.length <= 80 ? text : ''
  }

  function labelFor(el) {
    if (el.labels && el.labels.length) {
      const text = (el.labels[0].textContent || '').replace(/\s+/g, ' ').trim()
      if (text) return text
    }
    const wrapping = el.closest('label')
    if (wrapping) {
      const text = (wrapping.textContent || '').replace(/\s+/g, ' ').trim()
      if (text) return text
    }
    return ''
  }

  /**
   * An id that looks generated is worse than useless: it changes on the next
   * build and the test fails for no reason anyone can see.
   */
  function usableId(el) {
    const id = el.id
    if (!id) return ''
    if (/^[0-9]/.test(id)) return ''
    if (/^(radix|headlessui|mui|react-aria|ember|:r)/i.test(id)) return ''
    if (/[0-9a-f]{8,}/i.test(id)) return ''
    if (/^[a-z]+-[0-9]+$/i.test(id)) return ''
    return id
  }

  /** A structural path, used only when nothing better identifies the element. */
  function cssPath(el) {
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < 5) {
      let part = node.tagName.toLowerCase()
      const id = usableId(node)
      if (id) {
        parts.unshift('#' + CSS.escape(id))
        break
      }
      // Class names are included only when they look authored rather than
      // hashed by a CSS-in-JS tool.
      const stable = [...node.classList].filter((c) => /^[a-z][a-z0-9-_]{2,}$/i.test(c) && !/[0-9a-f]{6,}/i.test(c))
      if (stable.length) part += '.' + stable.slice(0, 2).map((c) => CSS.escape(c)).join('.')
      const parent = node.parentElement
      if (parent) {
        const siblings = [...parent.children].filter((c) => c.tagName === node.tagName)
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      node = node.parentElement
      if (node === document.body) break
    }
    return parts.join(' > ')
  }

  /** Counts what a candidate would match, which is what "unique" means. */
  function countMatches(candidate) {
    try {
      if (candidate.kind === 'testid') {
        return TEST_ID_ATTRS.reduce(
          (n, attr) => n + document.querySelectorAll('[' + attr + '="' + CSS.escape(candidate.value) + '"]').length,
          0,
        )
      }
      if (candidate.kind === 'id') return document.querySelectorAll('#' + CSS.escape(candidate.value)).length
      if (candidate.kind === 'css') return document.querySelectorAll(candidate.value).length
      if (candidate.kind === 'placeholder') {
        return document.querySelectorAll('[placeholder="' + CSS.escape(candidate.value) + '"]').length
      }
      if (candidate.kind === 'role') {
        return [...document.querySelectorAll('*')].filter(
          (n) => roleOf(n) === candidate.value && (!candidate.name || accessibleName(n) === candidate.name),
        ).length
      }
      if (candidate.kind === 'label') {
        return [...document.querySelectorAll('input, textarea, select')].filter(
          (n) => labelFor(n) === candidate.value,
        ).length
      }
      if (candidate.kind === 'text') {
        return [...document.querySelectorAll('*')].filter((n) => {
          if (n.children.length) return false
          return (n.textContent || '').replace(/\s+/g, ' ').trim() === candidate.value
        }).length
      }
    } catch {
      return 0
    }
    return 0
  }

  function candidatesFor(el) {
    const found = []
    const add = (kind, value, name) => {
      if (!value) return
      const candidate = { kind, value, name, unique: false }
      candidate.unique = countMatches(candidate) === 1
      found.push(candidate)
    }

    for (const attr of TEST_ID_ATTRS) {
      const value = el.getAttribute(attr)
      if (value) {
        add('testid', value)
        break
      }
    }

    const role = roleOf(el)
    if (role) add('role', role, accessibleName(el) || undefined)
    add('label', labelFor(el))
    add('placeholder', el.getAttribute && el.getAttribute('placeholder'))

    if (!el.children.length) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      if (text && text.length <= 60) add('text', text)
    }

    add('id', usableId(el))
    add('css', cssPath(el))
    return found
  }

  window.__novaE2ECandidates = candidatesFor

  /* ---------------- highlighting ---------------- */

  let box = null
  const showBox = (el) => {
    if (!box) {
      box = document.createElement('div')
      box.style.cssText =
        'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4aa3ff;' +
        'background:rgba(74,163,255,0.12);border-radius:2px;transition:all 60ms'
      document.documentElement.appendChild(box)
    }
    const r = el.getBoundingClientRect()
    box.style.left = r.left + 'px'
    box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'
    box.style.height = r.height + 'px'
    box.style.display = 'block'
  }
  const hideBox = () => {
    if (box) box.style.display = 'none'
  }

  /* ---------------- listeners ---------------- */

  const report = (el, action) => {
    const candidates = candidatesFor(el)
    send({ ...action, candidates })
  }

  const onPointerMove = (e) => {
    if (!state.picking) return
    const el = e.target
    if (el && el.nodeType === 1 && el !== box) showBox(el)
  }

  const onClick = (e) => {
    if (state.picking) {
      // Picking inspects; it must not also drive the page, or inspecting a
      // "Delete" button would delete something.
      e.preventDefault()
      e.stopPropagation()
      report(e.target, { type: 'picked' })
      return
    }
    if (!state.recording) return
    const el = e.target
    if (!el || el.nodeType !== 1) return

    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      report(el, { type: 'check', checked: el.checked })
      return
    }
    report(el, { type: 'click' })
  }

  const onChange = (e) => {
    if (!state.recording) return
    const el = e.target
    if (!el || el.nodeType !== 1) return
    if (el.tagName === 'SELECT') {
      report(el, { type: 'select', value: el.value })
      return
    }
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) return
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      report(el, { type: 'fill', value: el.value })
    }
  }

  const onKeyDown = (e) => {
    if (!state.recording) return
    // Only the keys that mean something on their own; every other keystroke
    // arrives as the field's final value through "change".
    if (['Enter', 'Escape', 'Tab'].includes(e.key)) send({ type: 'press', key: e.key })
  }

  // Capture phase throughout: a page that stops propagation on its own
  // handlers would otherwise make its most interesting elements unrecordable.
  document.addEventListener('click', onClick, true)
  document.addEventListener('change', onChange, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('pointermove', onPointerMove, true)

  window.__novaE2E = {
    start: () => {
      state.recording = true
      state.picking = false
      hideBox()
    },
    stop: () => {
      state.recording = false
      state.picking = false
      hideBox()
    },
    pick: (on) => {
      state.picking = Boolean(on)
      state.recording = false
      if (!on) hideBox()
    },
    state: () => ({ ...state }),
    teardown: () => {
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('change', onChange, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      if (box && box.parentNode) box.parentNode.removeChild(box)
      box = null
    },
  }

  send({ type: 'ready', url: location.href })
  return true
})()
`

/**
 * Reads one recorder message. Returns null for anything that is not ours, so
 * the host can hand it every console line the page produces.
 */
export function parseMessage(line: string): Record<string, unknown> | null {
  const at = line.indexOf(CHANNEL)
  if (at === -1) return null
  try {
    return JSON.parse(line.slice(at + CHANNEL.length))
  } catch {
    return null
  }
}
