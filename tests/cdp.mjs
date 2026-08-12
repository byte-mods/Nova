/**
 * CDP driver for the running Nova IDE.
 *
 * Input goes through `Input.dispatch*`, which produces *trusted* events — the
 * same thing a real mouse and keyboard produce. Monaco ignores synthetic
 * `MouseEvent`s for gestures like ⌘+click, so this is the only way to exercise
 * the editor the way a user does.
 */
export async function connect(port = Number(process.env.NOVA_DEBUG_PORT ?? 9223)) {
  const list = await (await fetch(`http://localhost:${port}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost'))
  if (!page) throw new Error('no renderer page found — is the IDE running with NOVA_DEBUG_PORT?')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    entry(message)
  })

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  const evaluate = async (expression, timeout = 60000) => {
    const result = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
      timeout,
    })
    const details = result.result?.exceptionDetails
    if (details) throw new Error(details.exception?.description ?? details.text)
    return result.result?.result?.value
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  /** Centre point of the first element matching `selector`, in CSS pixels. */
  const boxOf = (selector, nth = 0) =>
    evaluate(`
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const el = els[${nth}]
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return null
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    `)

  /** Centre point of the first element whose text contains `text`. */
  const boxOfText = (selector, text) =>
    evaluate(`
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find(e => (e.textContent || '').includes(${JSON.stringify(text)}))
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return null
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    `)

  const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
  const modMask = (mods = []) => mods.reduce((m, k) => m | (MODIFIERS[k] ?? 0), 0)

  async function clickPoint(point, { modifiers = [], button = 'left', clickCount = 1 } = {}) {
    const base = {
      x: point.x,
      y: point.y,
      button,
      clickCount,
      modifiers: modMask(modifiers),
      buttons: button === 'left' ? 1 : 2,
    }
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseMoved', buttons: 0 })
    await sleep(30)
    await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' })
    await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 })
  }

  /** Clicks the nth element matching a CSS selector. Returns false if absent. */
  async function click(selector, options = {}) {
    const point = await boxOf(selector, options.nth ?? 0)
    if (!point) return false
    await clickPoint(point, options)
    await sleep(options.settle ?? 200)
    return true
  }

  /** Clicks the first element matching the selector whose text contains `text`. */
  async function clickText(selector, text, options = {}) {
    const point = await boxOfText(selector, text)
    if (!point) return false
    await clickPoint(point, options)
    await sleep(options.settle ?? 200)
    return true
  }

  async function hover(point, modifiers = []) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
      modifiers: modMask(modifiers),
      buttons: 0,
    })
    await sleep(120)
  }

  /** Types text as real key events, so editors see it as user input. */
  async function type(text, delay = 12) {
    for (const ch of text) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', text: ch })
      if (delay) await sleep(delay)
    }
  }

  const KEYS = {
    Enter: { windowsVirtualKeyCode: 13, code: 'Enter', key: 'Enter', text: '\r' },
    Escape: { windowsVirtualKeyCode: 27, code: 'Escape', key: 'Escape' },
    Backspace: { windowsVirtualKeyCode: 8, code: 'Backspace', key: 'Backspace' },
    Tab: { windowsVirtualKeyCode: 9, code: 'Tab', key: 'Tab' },
    ArrowDown: { windowsVirtualKeyCode: 40, code: 'ArrowDown', key: 'ArrowDown' },
    ArrowUp: { windowsVirtualKeyCode: 38, code: 'ArrowUp', key: 'ArrowUp' },
    F2: { windowsVirtualKeyCode: 113, code: 'F2', key: 'F2' },
    F5: { windowsVirtualKeyCode: 116, code: 'F5', key: 'F5' },
    F6: { windowsVirtualKeyCode: 117, code: 'F6', key: 'F6' },
    F7: { windowsVirtualKeyCode: 118, code: 'F7', key: 'F7' },
    F8: { windowsVirtualKeyCode: 119, code: 'F8', key: 'F8' },
    F9: { windowsVirtualKeyCode: 120, code: 'F9', key: 'F9' },
    F10: { windowsVirtualKeyCode: 121, code: 'F10', key: 'F10' },
    F11: { windowsVirtualKeyCode: 122, code: 'F11', key: 'F11' },
    F12: { windowsVirtualKeyCode: 123, code: 'F12', key: 'F12' },
  }

  /** Presses a key, optionally with modifiers, e.g. key('p', ['meta']). */
  async function key(name, modifiers = []) {
    const mask = modMask(modifiers)
    const special = KEYS[name]
    const descriptor = special ?? {
      windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0),
      code: `Key${name.toUpperCase()}`,
      key: name,
    }
    // A modified key must not carry `text`, or the character is inserted too.
    const text = mask === 0 && !special ? name : special?.text
    await send('Input.dispatchKeyEvent', {
      type: text ? 'keyDown' : 'rawKeyDown',
      modifiers: mask,
      ...descriptor,
      ...(text ? { text, unmodifiedText: text } : {}),
    })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: mask, ...descriptor })
    await sleep(120)
  }

  /** Waits until `expression` returns truthy, or throws. */
  async function waitFor(expression, { timeout = 15000, interval = 250, label = '' } = {}) {
    const deadline = Date.now() + timeout
    let last
    while (Date.now() < deadline) {
      last = await evaluate(`return (${expression})`)
      if (last) return last
      await sleep(interval)
    }
    throw new Error(`timed out waiting for ${label || expression} (last: ${JSON.stringify(last)})`)
  }

  return { evaluate, send, click, clickText, clickPoint, boxOf, boxOfText, hover, type, key, waitFor, sleep, close: () => ws.close() }
}

/** Small assertion helper shared by the suites. */
export function reporter() {
  const results = []
  return {
    results,
    check(id, label, ok, detail = '') {
      results.push({ id, label, ok: Boolean(ok), detail })
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${id} ${label}${ok || !detail ? '' : ` — ${detail}`}`)
      return Boolean(ok)
    },
    async guard(id, label, fn) {
      try {
        const outcome = await fn()
        return this.check(id, label, outcome?.ok ?? outcome, outcome?.detail ?? '')
      } catch (err) {
        return this.check(id, label, false, String(err.message ?? err).slice(0, 200))
      }
    },
    summary(area) {
      const failed = results.filter((r) => !r.ok)
      console.log(
        `\n${area}: ${results.length - failed.length}/${results.length} passed` +
          (failed.length ? `\nfailed: ${failed.map((f) => f.id).join(', ')}` : ''),
      )
      return failed.length
    },
  }
}
