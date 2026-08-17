/**
 * The reference Nova plugin.
 *
 * `activate` receives the `nova` API object and is the only required export.
 * Everything it touches is gated by the `permissions` in nova-plugin.json —
 * remove one there and the matching call throws with a message naming it.
 */

export async function activate(nova) {
  nova.log.info(`Hello from ${nova.plugin.id}`)

  // A command declared in `contributes.commands`. The palette entry appears
  // once the plugin loads; this registers what it actually does.
  nova.commands.register('hello.count', async () => {
    const root = await nova.workspace.root()
    if (!root) {
      await nova.ui.showMessage('Open a project first.', 'warn')
      return
    }

    const files = await nova.workspace.findFiles('', 5000)
    const byExtension = new Map()
    for (const file of files) {
      const ext = file.includes('.') ? file.slice(file.lastIndexOf('.')) : '(none)'
      byExtension.set(ext, (byExtension.get(ext) ?? 0) + 1)
    }

    const top = Array.from(byExtension.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    await nova.ui.showMessage(`${files.length} files in this project.`)
    await nova.ui.setViewHtml('hello.panel', renderTable(files.length, top))
    return { total: files.length }
  })

  nova.commands.register('hello.describeActive', async () => {
    const file = await nova.editor.activeFile()
    if (!file) {
      await nova.ui.showMessage('No file is open.', 'warn')
      return
    }
    const selection = await nova.editor.selection()
    const lines = (selection?.text ?? '').split('\n').length
    await nova.ui.showMessage(`${file} — ${lines} lines, language ${selection?.language ?? 'unknown'}`)
  })

  // Status-bar items are keyed, so setting the same id again replaces it.
  await nova.ui.setStatusBarItem('hello.status', {
    text: 'Hello ✓',
    tooltip: 'The Hello Nova plugin is running',
    command: 'hello.count',
  })

  await nova.ui.setViewHtml('hello.panel', '<p>Run <b>Count files in this project</b> to fill this panel.</p>')

  // Anything returned with a `dispose` is called when the plugin is disabled.
  return {
    dispose() {
      nova.log.info('Hello Nova is shutting down.')
    },
  }
}

function renderTable(total, rows) {
  const body = rows
    .map(([ext, count]) => `<tr><td>${escapeHtml(ext)}</td><td style="text-align:right">${count}</td></tr>`)
    .join('')
  return `
    <h3 style="margin:0 0 8px">${total} files</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr><th style="text-align:left">Extension</th><th style="text-align:right">Files</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  })
}
