/**
 * Stands in for a vendor's Anthropic-compatible endpoint.
 *
 * It exists to answer one question that cannot be asked any other way: what
 * credential does the CLI actually put on the wire when Nova points it at a
 * third party? Setting `ANTHROPIC_AUTH_TOKEN` is not sufficient on its own —
 * the CLI prefers a stored OAuth session — and the failure is invisible from
 * inside the app, because the run succeeds. It just succeeds against the wrong
 * account, having sent the user's personal token to someone else's server.
 *
 * Recording the headers here is the only way that shows up as a test failure.
 */
import http from 'node:http'

export async function startVendorEndpoint() {
  const requests = []

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      requests.push({
        path: req.url,
        authorization: req.headers.authorization ?? '',
        apiKey: req.headers['x-api-key'] ?? '',
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'msg_stub',
          type: 'message',
          role: 'assistant',
          model: 'stub-model',
          content: [{ type: 'text', text: 'stub reply' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      )
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    /** Every credential the CLI presented, deduplicated. */
    credentials: () =>
      [...new Set(requests.map((r) => r.authorization || r.apiKey).filter(Boolean))],
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
