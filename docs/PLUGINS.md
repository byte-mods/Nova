# Writing a Nova plugin

A plugin is a **git repository with a `nova-plugin.json` at its root**. There is
no registry and no publishing step: you push the repo, a user pastes the URL
into **Plugins → Install from git**, and Nova clones it.

- [Quick start](#quick-start)
- [The manifest](#the-manifest)
- [Permissions](#permissions)
- [The API](#the-api)
- [Contributing an MCP server](#contributing-an-mcp-server)
- [How isolation works](#how-isolation-works)
- [Installing, updating, uninstalling](#installing-updating-uninstalling)

A complete working example lives in [`examples/hello-plugin`](../examples/hello-plugin)
— one command, one view, one MCP server. Copy that directory to start.

---

## Quick start

```
my-plugin/
├── nova-plugin.json
└── index.mjs
```

`nova-plugin.json`:

```json
{
  "id": "com.example.my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "main": "index.mjs",
  "permissions": ["workspace:read", "ui"],
  "contributes": {
    "commands": [{ "id": "my.hello", "title": "Say hello", "category": "My Plugin" }]
  }
}
```

`index.mjs`:

```js
export async function activate(nova) {
  nova.commands.register('my.hello', async () => {
    const root = await nova.workspace.root()
    await nova.ui.showMessage(`Project: ${root}`)
  })
}
```

Commit, push, and install the URL. To iterate locally without pushing, install
`file:///absolute/path/to/my-plugin` — Nova clones local repositories too.

---

## The manifest

| Field | Required | What it does |
|---|---|---|
| `id` | yes | Reverse-DNS identifier. Also the install directory name. |
| `name` | yes | Display name. |
| `version` | yes | Semver. |
| `main` | no | Entry module, relative to the repo root. Omit for a manifest-only plugin (one that just ships an MCP server). |
| `description`, `author`, `homepage`, `license` | no | Shown in the Plugins view. |
| `engine` | no | Semver range of Nova you support. |
| `build` | no | Shell run once after clone, e.g. `npm install && npm run build`. |
| `permissions` | no | See below. Nothing is granted implicitly. |
| `contributes` | no | `commands`, `views`, `mcpServers`. |

The manifest is validated on install and **every problem is reported at once**,
so you fix them in one pass rather than one clone at a time.

---

## Permissions

A plugin that declares no permissions can register commands and read its own
storage — nothing else. Every other call names the permission it needs in the
error when it is missing.

| Permission | Unlocks |
|---|---|
| `workspace:read` | `workspace.readFile`, `list`, `findFiles`, `search` |
| `workspace:write` | `workspace.writeFile` |
| `editor` | `editor.*` — active file, selection, edits, opening files |
| `ui` | `ui.*` — toasts, views, status-bar items, prompts |
| `shell` | `shell.exec`, and **required** to ship an MCP server |
| `net` | Outbound network requests |
| `git` | `git.status`, `git.log` |
| `secrets` | `secrets.get` / `secrets.set` |

The user sees this list before installing and ticks what they will grant. A
plugin that asks for `shell` and is told no still installs — it just cannot
spawn anything. Declining is a supported outcome, so **handle the rejection**:

```js
try {
  await nova.shell.exec('git status')
} catch {
  await nova.ui.showMessage('Grant shell access to enable this.', 'warn')
}
```

Granting more later (**Grant now** in the Plugins view) reloads the plugin,
because permissions are captured when it loads.

---

## The API

`activate(nova)` is the only required export. Return an object with `dispose()`
to clean up, or export `deactivate()`.

```js
nova.plugin.id / .dir

nova.commands.register(id, handler)   // handler's return value reaches the caller
nova.commands.execute(commandId)      // run a built-in Nova command

nova.workspace.root() / readFile(f) / writeFile(f, text) / list(dir)
nova.workspace.findFiles(query, limit) / search(query, options)

nova.editor.activeFile() / selection() / applyEdit(file, {text}) / open(file, line)

nova.ui.showMessage(text, 'info'|'warn'|'error')
nova.ui.setViewHtml(viewId, html)     // renders into a contributed view
nova.ui.setStatusBarItem(id, {text, tooltip, command})
nova.ui.prompt(question, choices)

nova.git.status() / log(limit)
nova.shell.exec(command, {cwd})       // resolves {ok, stdout, stderr}
nova.storage.get(key) / set(key, value)
nova.secrets.get(key) / set(key, value)
nova.log.info / warn / error
```

Paths are resolved against the open project and **anything outside it is
refused**, including via `..`. `editor.applyEdit` replaces the whole buffer;
partial range edits are not offered because rebasing them against edits the user
made while your plugin was thinking is a good way to corrupt a file silently.

---

## Contributing an MCP server

This is the highest-leverage thing a plugin can do: it hands the **assistant**
new tools, which reach into every prompt the user runs in the AI console.

```json
"permissions": ["shell"],
"contributes": {
  "mcpServers": [
    {
      "name": "project-stats",
      "command": "node",
      "args": ["mcp-server.mjs"],
      "description": "Counts files by extension."
    }
  ]
}
```

Nova merges these into the config it passes to the Claude and Codex CLIs on the
next prompt — **merged with, not substituted for**, the user's own MCP config.
Server names are namespaced as `<plugin_id>__<name>`, so two plugins can ship a
server with the same name. `cwd` defaults to the plugin directory and
`NOVA_PLUGIN_DIR` is always set in the server's environment.

`stdio` is the only transport, because it is the only one both CLIs accept from
a local config. See [`examples/hello-plugin/mcp-server.mjs`](../examples/hello-plugin/mcp-server.mjs)
for a dependency-free implementation; real plugins should use
`@modelcontextprotocol/sdk` and a `build` step.

---

## How isolation works

**Every plugin runs in its own forked Node process.** Not the main process, not
the renderer. A plugin that throws, leaks or spins cannot take the editor down,
and it has no handle on `BrowserWindow`, `ipcMain` or the DOM.

The per-plugin process is a security requirement rather than a nicety. Your code
runs inside its host with full Node access, so it can bypass the API facade and
write straight to the parent's IPC channel. If the editor read your identity
from a field *in the message*, any plugin could claim to be any other and
inherit its grants — a probe during development confirmed a plugin declaring no
permissions could borrow another's `shell` grant. Identity therefore comes from
the channel the message arrives on, which requires one process per plugin.

Practical consequences:

- Permission checks in the host are for **error messages**. The main process
  re-checks everything and is the only authority.
- A crashed plugin is reported in the Plugins view and does not affect others.
- `dispose()` gets ~100ms before the process is killed.

---

## Installing, updating, uninstalling

Plugins live in `<userData>/plugins/<id>`, with a `registry.json` recording the
source URL, resolved commit and granted permissions. The registry is the source
of truth — a directory with no entry is treated as absent, since the entry is
the only place consent is recorded.

- **Install** clones into a staging directory and only promotes it once the
  manifest validates, so a broken push cannot overwrite a working install.
- **Update** is `git fetch` + `reset --hard`, then a rebuild. Permissions you
  did not previously have stay ungranted until re-approved.
- **Uninstall** deletes the directory. Only paths inside the plugins root are
  ever removed.

`ext::` URLs and URLs carrying git options (`--upload-pack` and friends) are
rejected: they turn a pasted "repository" into arbitrary code execution before
any manifest is read. `https://`, `ssh://`, `git://`, `file://` and
`git@host:path` are accepted.

> `build` runs the repository's own shell command. That is the same trust a user
> extends by installing at all, but it is the single most dangerous moment in
> the flow — it is bounded by a 10-minute timeout and never inherits an
> interactive stdin.
