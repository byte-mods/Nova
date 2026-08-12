# Installation

Nova is an Electron app built with Vite. There is no installer step beyond
`npm install` — everything else is optional tooling that Nova detects at runtime.

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Troubleshooting the install](#troubleshooting-the-install)
- [Optional: language servers](#optional-language-servers)
- [Optional: debug adapters](#optional-debug-adapters)
- [Optional: the AI CLIs](#optional-the-ai-clis)
- [Building a distributable](#building-a-distributable)
- [Running the test suites](#running-the-test-suites)
- [Platform notes](#platform-notes)

---

## Requirements

| | |
|---|---|
| **Node.js** | 20 or newer (`node --version`) |
| **npm** | 10 or newer, ships with Node |
| **git** | required for the Git panel; the rest of the IDE works without it |
| **Disk** | ~600 MB for `node_modules`, most of it the Electron binary |

`node-pty` provides the terminal's pseudo-terminal. It ships N-API prebuilds, so
there is no compiler step — but npm 10.9+ gates its install script, which is what
marks the helper binary executable. Nova repairs that at load time, so the
terminal works either way; approving the script simply avoids the repair:

```bash
npm install-scripts approve node-pty
```

Everything else — language servers, debug adapters, the `claude` and `codex`
CLIs — is optional. Nova probes your `PATH` on start and shows what it found in
**Settings**, with an install command for each thing it did not find.

---

## Quick start

```bash
git clone https://github.com/byte-mods/Nova.git
```

```bash
cd Nova && npm install
```

```bash
npm run dev
```

The window opens on the welcome screen. Use **Open folder…** (or `⌘P` once a
project is open) to point it at a project. Nova indexes the tree on open; the
status bar shows the symbol count when it finishes.

---

## Troubleshooting the install

### `Electron failed to install correctly`

npm 10.9 and later block package install scripts by default, so Electron's
binary is never downloaded. Approve it and reinstall:

```bash
npm install-scripts approve electron
```

```bash
rm -rf node_modules && npm install
```

If extraction still leaves `node_modules/electron/dist` incomplete — no
`path.txt` — unzip the cached download by hand:

```bash
unzip -q ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip -d node_modules/electron/dist && printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
```

`scripts/ensure-electron.mjs` runs on `postinstall` and before `npm run dev`, and
will tell you which of these applies.

### The window is blank

Vite serves the renderer on port 5179. If something else holds that port, stop it
and restart. `/tmp/nova-dev.log` has the dev-server output when Nova was started
through `tests/restart-app.sh`.

### Changes to `electron/` do not take effect

Main-process code is rebuilt but Electron must relaunch to pick it up. Renderer
changes hot-reload; main-process changes need a restart:

```bash
./tests/restart-app.sh
```

---

## Optional: language servers

Without a language server Nova falls back to its own symbol index, which already
answers go-to-definition, find usages, go-to-symbol and completion. Installing one
makes all of that *type-aware* and adds rename, quick fixes, formatting, inlay
hints, signature help and call/type hierarchy.

Nova looks for 24 servers. **Settings › Language servers** lists each one with its
status and install command. The common ones:

```bash
npm i -g typescript-language-server typescript
```

```bash
npm i -g pyright
```

```bash
go install golang.org/x/tools/gopls@latest
```

```bash
rustup component add rust-analyzer
```

Also detected: `pylsp`, `clangd`, `sourcekit-lsp`, `jdtls`,
`kotlin-language-server`, `csharp-ls`, `ruby-lsp`, `solargraph`, `intelephense`,
`dart`, `elixir-ls`, `lua-language-server`, `bash-language-server`,
`yaml-language-server`, the `vscode-langservers-extracted` trio (HTML/CSS/JSON),
`terraform-ls`, `haskell-language-server` and `sqls`.

`clangd` needs a `compile_commands.json` in the project root to resolve includes.

---

## Optional: debug adapters

Nova speaks the Debug Adapter Protocol, so any adapter on your `PATH` works.
**Settings › Debuggers** shows what was found.

```bash
python3 -m pip install debugpy
```

```bash
go install github.com/go-delve/delve/cmd/dlv@latest
```

`lldb-dap` ships with the Xcode command line tools on macOS. `codelldb` is a
manual download — put the binary on your `PATH`.

---

## Optional: the AI CLIs

The AI console and the **Explain** button drive whichever CLI you have installed.

```bash
npm install -g @anthropic-ai/claude-code
```

```bash
npm install -g @openai/codex
```

Then hit **Re-detect CLIs** in Settings. GUI apps do not inherit a login shell's
`PATH`, so Nova also searches `~/.local/bin`, `~/.bun/bin`, `~/.cargo/bin`,
`/opt/homebrew/bin` and `/usr/local/bin` when locating them.

Both CLIs run in your project directory. The AI console's permission mode is
configurable (auto-edit, plan-only, ask-first, full access); the Explain button
always uses plan-only, so a generated walkthrough can never modify your code.

---

## Building a distributable

```bash
npm run dist:mac
```

`npm run dist` builds for the current platform instead. Both typecheck and build
the renderer first, then run `electron-builder`. Output lands in `release/`.

The macOS target is an unsigned `.dmg`. To ship it, add your signing identity and
notarisation credentials to the `build` block in `package.json` — see the
[electron-builder docs](https://www.electron.build/code-signing).

---

## Running the test suites

```bash
npm test
```

runs everything that does not need the app running: declaration parsing, the
symbol index, the edit applier, test-framework detection, the refactoring engine
(76 checks) and the Explain prompt contract, plus the tooling suites when
`clangd`, `rust-analyzer` and `debugpy` are present.

The UI suite drives the running app over the Chrome DevTools Protocol with real
mouse and keyboard events. Start the app with a debug port, then run it:

```bash
NOVA_DEBUG_PORT=9223 npm run dev
```

```bash
npm run test:ui
```

`tests/restart-app.sh` restarts the app with the port free, which is what you
want after any main-process change. Two of the UI checks call a real AI CLI, so
that section needs `claude` or `codex` installed.

---

## Platform notes

**macOS** — the primary development target; everything here is exercised on it.
`lldb-dap` and `clangd` come from the Xcode command line tools.

**Linux** — builds and runs. The terminal uses your `$SHELL`. Install
`libnss3`, `libatk-bridge2.0-0` and `libgtk-3-0` if Electron refuses to start.

**Windows** — the terminal uses ConPTY through `node-pty` and `COMSPEC`. Other
code paths are POSIX-flavoured in places (path separators in the refactoring
engine's import rewriting). Expect rough edges; WSL is the smoother route today.
