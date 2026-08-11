/** Minimal CDP driver: evaluates expressions inside the real Nova IDE renderer. */
export async function connect(port = 9223) {
  const list = await (await fetch(`http://localhost:${port}/json/list`)).json()
  const page = list.find((t) => t.type === 'page' && t.url.includes('localhost'))
  if (!page) throw new Error('no renderer page found')
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
      const seq = ++id
      pending.set(seq, resolve)
      ws.send(JSON.stringify({ id: seq, method, params }))
    })

  /** Runs an async expression in the page and returns its JSON value. */
  const evaluate = async (expression, timeout = 60000) => {
    const result = await send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
      timeout,
    })
    if (result.result?.exceptionDetails) {
      throw new Error(
        result.result.exceptionDetails.exception?.description ??
          result.result.exceptionDetails.text,
      )
    }
    return result.result?.result?.value
  }

  return { evaluate, close: () => ws.close() }
}
