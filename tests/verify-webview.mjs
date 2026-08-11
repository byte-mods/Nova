import { connect } from './cdp.mjs'
const cdp = await connect()
let fails = 0
const check=(l,ok,d='')=>{ console.log(ok?`  PASS  ${l}`:`  FAIL  ${l} — ${d}`); if(!ok) fails++ }

const r = await cdp.evaluate(`
  const s = (await import('/src/state/store.ts')).useStore
  s.getState().openTab({ id:'browser:live', kind:'browser', title:'Browser', url:'http://localhost:4173/' })
  await new Promise(r=>setTimeout(r,1200))
  const wv = document.querySelector('webview')
  if (!wv) return { error: 'no webview' }
  // Wait for the guest to finish loading.
  await new Promise((resolve) => {
    if (!wv.isLoading || !wv.isLoading()) return resolve()
    wv.addEventListener('did-stop-loading', resolve, { once: true })
    setTimeout(resolve, 8000)
  })
  await new Promise(r=>setTimeout(r,1200))
  // Read real DOM out of the guest page — proof it actually rendered.
  const title = await wv.executeJavaScript('document.title')
  const heading = await wv.executeJavaScript("document.querySelector('h1').textContent")
  const live = await wv.executeJavaScript("document.getElementById('t').textContent")
  const bg = await wv.executeJavaScript("getComputedStyle(document.body).backgroundColor")
  const size = await wv.executeJavaScript("[document.body.clientWidth, document.body.clientHeight]")
  return { url: wv.getURL(), title, heading, live, bg, size }
`, 40000)

console.log('  info ', JSON.stringify(r))
check('webview navigated to the project dev server', r.url === 'http://localhost:4173/', r.url)
check('guest page rendered its DOM (title + heading)', r.title === 'Acme Shop' && r.heading === 'Acme Shop', JSON.stringify(r))
check('page JavaScript executed inside the pane', typeof r.live === 'string' && r.live.includes('Live preview inside Nova IDE'), r.live)
check('page painted with real layout', Array.isArray(r.size) && r.size[0] > 100 && r.size[1] > 100, JSON.stringify(r.size))

// Navigate via the address bar path and confirm history works.
const nav = await cdp.evaluate(`
  const wv = document.querySelector('webview')
  await wv.loadURL('http://localhost:4173/?page=2')
  await new Promise(r=>setTimeout(r,1500))
  const after = wv.getURL()
  const canBack = wv.canGoBack()
  wv.goBack()
  await new Promise(r=>setTimeout(r,1500))
  return { after, canBack, back: wv.getURL() }
`, 30000)
check('in-pane navigation + history works', nav.after.includes('page=2') && nav.canBack, JSON.stringify(nav))

console.log(fails ? `\n${fails} failed` : '\nbrowser pane verified')
cdp.close(); process.exit(fails?1:0)
