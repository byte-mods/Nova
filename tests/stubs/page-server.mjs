/**
 * Two static pages the browser-pane suite navigates between.
 *
 * The pane hosts a real Chromium `<webview>`, so the checks that matter are
 * whether the guest actually parsed and rendered a document and whether its
 * session history moves. Both need a server that answers on a real socket;
 * pointing the pane at whatever happened to be listening on the port made the
 * result depend on the machine, and Nova's own SPA has no `<h1>` to look for.
 */
import http from 'node:http'

const page = (heading) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Nova browser fixture</title></head>` +
  `<body><h1>${heading}</h1><p id="body-text">served by the fixture</p></body></html>`

export async function startPageServer(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(page(url.searchParams.has('second') ? 'Second page' : 'First page'))
  })

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    port: server.address().port,
    origin: `http://localhost:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
