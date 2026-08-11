# Nova IDE

A desktop IDE built on Electron + React + TypeScript. Editor, embedded Chromium
browser, architecture/UML diagram designer, Git client and an AI console that
pipes to the `claude` and `codex` CLIs — all in one window.

```bash
npm install
npm run dev
```

---

## What's in it

### Editor

Monaco, the same engine VS Code uses, with grammars for every popular language
(TypeScript, JavaScript, Python, Go, Rust, Java, Kotlin, Swift, C/C++, C#, PHP,
Ruby, Dart, Elixir, SQL, GraphQL, Terraform, shell, YAML/TOML, and more — see
[`src/lib/language.ts`](src/lib/language.ts)).

- Tabs with preview-on-single-click, dirty markers, middle-click close
- Go to file (`⌘P`), command palette (`⇧⌘P`), project-wide search (`⇧⌘F`)
- Problems panel fed by Monaco diagnostics
- Bracket-pair colouring, sticky scroll, minimap, indent guides

### Code navigation

The whole project is indexed on open, and the index drives IntelliJ-style
navigation:

- **⌘/Ctrl + click** (or `F12`) on any identifier jumps to its declaration,
  across files. Hold ⌘ to see the link underline first.
- **⌥F7** — *Find Usages*: every reference in the project, grouped by file in a
  dedicated panel, each labelled `declaration` / `usage` / `import`. Matches
  inside comments and string literals are separated behind a toggle.
- **⇧F12** — peek references inline.
- **⇧⌘O** — *Go to Symbol in Project*: fuzzy search every class, function,
  method, constant and global, with kind badges and containers.
- **⌘⇧O** in the editor, or the outline via Monaco's document symbols.

Declarations are parsed per language rather than through a language server, so
navigation works with no extra tooling installed and covers the whole popular
set: TypeScript/JavaScript, Python, Go, Rust, Java, Kotlin, Scala, Swift,
Objective-C, C, C++, C#, Ruby, PHP, Dart, Elixir, Erlang, Haskell, Clojure, Lua,
R, Julia, Perl, shell, PowerShell, SQL, GraphQL, Protobuf, HCL/Terraform,
Solidity, CSS/SCSS, F#, Visual Basic and Pascal. Anything else falls back to a
generic declaration pattern.

The index is incremental — the file watcher re-parses only what changed, so
edits (including the AI console's) are reflected immediately. On a 1,200-file
tree it builds in ~0.5 s and answers a find-usages query in ~20 ms.

### Language servers

When a language server is already on your `PATH`, Nova speaks LSP to it and the
navigation above becomes *type-aware* — `service.create()` resolves to the method
on that receiver rather than every `create` in the project. Nothing is bundled
and nothing is required: without a server, everything falls back to the symbol
index.

What the LSP layer adds:

| | |
| --- | --- |
| Completion | context- and type-aware, with snippets and auto-imports |
| Diagnostics | live squiggles from the compiler, listed in the Problems panel |
| Hover | real signatures and doc comments |
| Signature help | parameter hints while typing a call |
| **Rename** (`⇧F6` / `F2`) | safe, scope-aware, applied across every file |
| **Quick fixes** (`⌥⏎`) | the server's code actions, including multi-file ones |
| Format document | `⌥⌘L` |
| Go to implementation | `⌥⌘B` |
| Inlay hints | inline parameter and type hints |
| Call hierarchy | who calls this, and what it calls |
| Type hierarchy | supertypes and subtypes (where the server supports it) |

Rename and multi-file quick fixes show a **preview** first — the affected files,
the edit count and a diff per file — before anything is written. They apply
through Nova's own `WorkspaceEdit` applier rather than Monaco's, because the
standalone editor cannot edit files it has no model for. Edits are applied last-first per file, conflicting edits are
refused rather than half-applied, and open buffers are routed through the editor
so undo still works.

24 servers are pre-configured (see Settings › Language servers for the list and
install command for each): `typescript-language-server`, `pyright`, `pylsp`,
`gopls`, `rust-analyzer`, `clangd`, `sourcekit-lsp`, `jdtls`,
`kotlin-language-server`, `csharp-ls`, `ruby-lsp`, `solargraph`, `intelephense`,
`dart`, `elixir-ls`, `lua-language-server`, `bash-language-server`,
`yaml-language-server`, the `vscode-langservers-extracted` trio,
`terraform-ls`, `haskell-language-server` and `sqls`.

### Debugging

Nova speaks the **Debug Adapter Protocol**, so any adapter on your `PATH`
works: breakpoints in the gutter, step over/into/out, call stack, scoped
variables with expandable values, watch expressions, and a debug console.
`debugpy`, `dlv`, `lldb-dap` and `codelldb` are pre-configured — see
Settings › Debuggers.

| | |
| --- | --- |
| `F5` | Start / continue |
| `⇧F5` | Stop |
| `F10` | Step over |
| `F11` / `⇧F11` | Step into / out |
| gutter click | Toggle breakpoint (⌥-click on a test line) |

### Tests

Test frameworks are detected from the project — go, cargo, pytest, vitest, jest,
rspec, PHPUnit, Gradle, Maven, or an npm `test` script. Results appear as a
grouped tree with pass/fail/skip counts, durations and failure output; a green
▶ in the gutter runs a single test. Go, cargo, pytest, jest and vitest are
parsed into per-test results; anything else still runs and streams its output.

### Local History

Every overwrite of a file is snapshotted, independent of Git — including the
ones the AI console makes. Right-click a file → **Local History** to browse
revisions and diff or restore any of them. Snapshots coalesce within a minute,
keep 60 revisions per file, and expire after 30 days.

### Markdown reader

Split source/preview with GitHub-flavoured rendering, tables, task lists, and
**live Mermaid rendering** for ` ```mermaid ` fences. Fenced code blocks are
syntax-highlighted with Monaco, so they always match the active theme.

### Diagram designer

`.nova-diagram.json` files open in a dedicated editor with two modes:

- **Canvas** — drag-and-drop nodes on a snapping grid, ten shapes (rounded, UML
  class, datastore cylinder, queue hexagon, decision diamond, cloud, actor,
  note…), **50 swappable icons per node**, per-node colours, pan/zoom, fit to
  content, and SVG/PNG export.
- **Mermaid** — a live-preview source editor for sequence, class, ER, state, C4
  and flowchart diagrams.

UML relationships are first class: association, dependency, inheritance,
implementation, composition and aggregation each render with the correct
arrowhead and line style.

Six starter templates ship in the Diagrams sidebar: blank, microservices,
layered architecture, UML class diagram, sequence diagram and C4 context.

### Built-in Chromium browser

An Electron `<webview>` pane with a real address bar, back/forward/reload,
history, per-page devtools, zoom, and responsive presets (fit / 1280 / 834 /
390). If a page fails to load it offers to detect and start your project's dev
server, then reloads the preview — so you can build UI and see it without
leaving the IDE.

### Git

Branch picker, staged/unstaged change lists with per-file stage, unstage and
discard, commit (with commit-all), full commit history, and a commit viewer with
a file list and colourised unified diff. Fetch, pull, push and stash from the
panel header; right-click any commit to revert, cherry-pick or reset onto it.
**Blame** puts per-line authorship beside the editor — click a line to open the
commit that introduced it. Working-tree changes open as a
side-by-side or inline Monaco diff. File-tree entries carry `M`/`A`/`U`/`D`
decorations and the status bar shows branch, ahead/behind and change counts.

### AI console

The right-hand panel runs a coding agent **in your project directory with full
project access**, streaming its work as it goes.

- Pick **Claude** or **Codex** — the app detects each CLI on `PATH` and shows
  install hints when one is missing
- Permission modes: auto-edit, plan-only, ask-first, full access
- Streams assistant text (rendered as markdown), reasoning, and every tool call
  with its input and result
- **Every file the agent touches becomes a reviewable change card** with
  `+`/`−` line counts, a one-click side-by-side diff in the editor, and a revert
  button
- Conversations continue across turns via the CLI's own session resume

Under the hood:

| Provider | Command |
| --- | --- |
| Claude | `claude -p --output-format stream-json --verbose --permission-mode <mode>` |
| Codex | `codex exec --json --skip-git-repo-check -C <cwd>` |

Changes are captured two ways so nothing is missed: edit tool events snapshot the
file immediately before and after the write, and a `git status` diff before/after
the run catches anything the agent changed by other means (a shell command, a
script it ran).

### Themes

Ten complete themes — Nova Dark, Tokyo Night, Dracula, Nord, One Dark Pro,
Monokai Pro, Gruvbox Dark, Midnight Ocean, GitHub Light and Solarized Light.
Each drives the whole application: chrome, editor, terminal, Mermaid diagrams and
markdown preview all change together. Three file-icon packs (Nova, Classic,
Minimal) are switchable independently.

### Terminal

Multiple shells in the bottom panel, with command history, `cd` persistence
between commands, and `⌃C` to interrupt.

---

## Keyboard shortcuts

| | |
| --- | --- |
| `⌘P` | Go to file |
| `⇧⌘P` | Command palette |
| `⇧⌘O` | Go to symbol in project |
| `⌘`+click / `F12` | Go to definition |
| `⌥F7` | Find usages |
| `⇧F12` | Peek references |
| `⇧F6` / `F2` | Rename symbol |
| `⌥⏎` | Quick fixes |
| `⌥⌘B` | Go to implementation |
| `⌥⌘L` | Format document |
| `⌃⌥H` / `⌃H` | Call / type hierarchy |
| `F5` · `F10` · `F11` | Debug: start · step over · step into |
| `⇧⌘F` | Search in project |
| `⇧⌘G` | Source control |
| `⌘S` / `⇧⌘S` | Save / save all |
| `⌘B` | Toggle sidebar |
| `⌘J` | Toggle bottom panel |
| `⌘I` | Toggle AI console |
| `⌃\`` | Terminal |
| `⌘1…9` | Jump to tab |

In the diagram canvas: drag empty space to pan, `⌘`/`Ctrl` + scroll to zoom,
`⌥` while dragging to bypass grid snapping, `⌫` to delete, `⌘D` to duplicate.

---

## Architecture

```
electron/
  main.ts            window, webview policy, IPC registration
  preload.ts         the contextBridge API exposed as window.nova
  ipc/
    app.ts           dialogs, recents, persisted settings
    fs.ts            listing, read/write, search, fuzzy find, watching
    git.ts           porcelain parsing, log, diff, staging, commit
    ai.ts            CLI spawning, stream parsing, change capture
    shell.ts         terminal processes, dev-server detection
    indexer.ts       IPC surface for the symbol index
    lsp.ts           IPC surface for language servers
  lib/
    parseSymbols.ts  per-language declaration extraction
    projectIndex.ts  the index engine: build, refresh, definitions, references
    lspClient.ts     JSON-RPC 2.0 over Content-Length framed stdio
    lspManager.ts    server lifecycle, document sync, request wrappers
    lspRegistry.ts   the 24 known servers and how to detect them
    dapClient.ts     Debug Adapter Protocol client
    debugSession.ts  breakpoints, stepping, stack, variables, evaluate
    debugRegistry.ts the known debug adapters
    testFrameworks.ts test detection, command building and result parsing
    localHistory.ts  per-file revision snapshots
    runConfigs.ts    detected + custom run configurations
shared/types.ts      the IPC contract, shared by both sides
src/
  state/store.ts     Zustand store: tabs, buffers, git, AI messages, settings
  theme/themes.ts    the ten themes + Monaco theme generation
  components/        sidebar, editor, diagram, browser, ai, panel
```

The renderer has no Node access: `contextIsolation` is on, `nodeIntegration` is
off, and everything crosses through the typed `window.nova` bridge. Guest pages
in the browser pane are stripped of any preload and cannot reach it at all.

## Building a distributable

```bash
npm run dist:mac
```

## Troubleshooting

**`Electron failed to install correctly`** — npm 10.9+/11 blocks package install
scripts by default, so Electron's binary is never downloaded. Approve it and
reinstall:

```bash
npm install-scripts approve electron
```

If the extraction still leaves `node_modules/electron/dist` incomplete (no
`path.txt`), unzip the cached download by hand:

```bash
unzip -q ~/Library/Caches/electron/*/electron-v*-darwin-arm64.zip -d node_modules/electron/dist && printf 'Electron.app/Contents/MacOS/Electron' > node_modules/electron/path.txt
```

**AI console says the CLI was not found** — install the one you want and hit
*Re-detect CLIs* in Settings:

```bash
npm install -g @anthropic-ai/claude-code
```

```bash
npm install -g @openai/codex
```

GUI apps do not inherit a login shell `PATH`, so Nova also searches
`~/.local/bin`, `~/.bun/bin`, `~/.cargo/bin`, `/opt/homebrew/bin` and
`/usr/local/bin` when locating them.
