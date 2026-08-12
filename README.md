<div align="center">

# Nova

**A desktop IDE that brings IntelliJ-grade code intelligence, a Chromium browser, a diagram designer and an AI pair to one window — with no language server required.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-117%20UI%20%2B%20120%20offline-brightgreen.svg)](tests/FEATURES.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-lightgrey.svg)](docs/INSTALLATION.md)

<img src="docs/screenshot.png" alt="Nova IDE — editor, project tree, symbol index and the Explain button" width="100%">

</div>

---

## What it is

Nova is a full IDE in an Electron window: the Monaco editor, a project-wide symbol
index, thirteen refactorings, a debugger, a test runner, Git, a real Chromium
pane, a UML/architecture diagram designer, and an AI console wired to the
`claude` and `codex` CLIs.

Two things make it unusual:

**It works with nothing installed.** The whole project is indexed on open by a
per-language declaration parser, and that index — not a language server — drives
go-to-definition, find usages, go-to-symbol, autocomplete and every refactoring.
Install a language server and everything becomes type-aware; don't, and it still
works.

**It explains itself.** An **Explain** button above any open file generates a
full walkthrough of that code — the theory behind it, a step-by-step trace,
live Mermaid system-design diagrams, and a build-it-yourself tutorial.

---

## Install

Requires **Node.js 20+** and npm.

```bash
git clone https://github.com/byte-mods/Nova.git
```

```bash
cd Nova && npm install
```

```bash
npm run dev
```

That is the whole setup. Language servers, debug adapters and the AI CLIs are all
optional — Nova detects whatever is on your `PATH` and degrades cleanly when
something is missing.

> **npm 10.9+ blocks install scripts**, so Electron's binary may not download.
> If you see `Electron failed to install correctly`, run
> `npm install-scripts approve electron` and reinstall. Full instructions,
> optional tooling and platform notes: **[docs/INSTALLATION.md](docs/INSTALLATION.md)**

---

## Features

A short tour. The complete reference is in **[docs/FEATURES.md](docs/FEATURES.md)**.

### Code intelligence without tooling

The project is indexed on open — a 1,200-file tree builds in ~0.5 s and answers a
find-usages query in ~20 ms. The index is incremental, so edits (including the AI
console's) land immediately.

- **⌘-click / `F12`** — go to definition, across files
- **⌥F7** — find usages, grouped by file, each labelled *declaration* / *usage* /
  *import*, with comment and string matches behind a toggle
- **⇧⌘O** — go to symbol in project, with kind badges and containers
- **Autocomplete** in every language, fed by the index

Declarations are parsed per language, covering TypeScript/JavaScript, Python, Go,
Rust, Java, Kotlin, Scala, Swift, Objective-C, C, C++, C#, Ruby, PHP, Dart,
Elixir, Erlang, Haskell, Clojure, Lua, R, Julia, Perl, shell, PowerShell, SQL,
GraphQL, Protobuf, HCL/Terraform, Solidity, CSS/SCSS, F#, Visual Basic and
Pascal.

### Thirteen refactorings, on IntelliJ's keymap

<img src="docs/refactor.png" alt="The Extract Variable preview: affected files, edit count and a per-file diff" width="100%">

**⌃T** opens *Refactor This* — everything that applies where the caret is, with
the rest explaining why they don't.

| | | | |
|---|---|---|---|
| `⌥⌘V` Extract Variable | `⌥⌘C` Extract Constant | `⌥⌘F` Extract Field | `⌥⌘M` Extract Method |
| `⌥⌘P` Extract Parameter | `⌥⌘N` Inline Variable | Inline Method | `⌘F6` Change Signature |
| Introduce Parameter Object | `F6` Move File | Move Class | Pull Up · Push Down |
| `⌘⌫` Safe Delete | | | |

Every one ends in the preview above — affected files, edit count, per-file diff —
before a byte is written. None of them needs a language server.

The engine masks strings and comments, then reasons over what is left. That is
why it works on any project with no tooling, and why it **refuses rather than
guesses**: a variable assigned twice won't inline, a selection producing two live
values won't extract, and a language with no profile says so instead of writing
something plausible-looking.

### Explain this file

<img src="docs/explain.png" alt="A generated walkthrough with a live Mermaid system-design diagram" width="100%">

Press the **Explain** button (or `⌥⌘E`). A read-only agent run reads the file —
optionally its imports, callers and tests too — and streams back:

1. what it is, in one paragraph
2. **the concept behind it** — the algorithm, pattern or protocol it instantiates
3. how it works, step by step, against the real identifiers
4. **system design** — a component flowchart, a sequence diagram of one full
   operation, plus class or ER diagrams where the file warrants them
5. a table of everything it exposes
6. the design decisions, and what each one costs
7. **build it yourself** — a tutorial reconstructing the idea from nothing
8. pitfalls, and three exercises against this codebase

Diagrams render live as they arrive, in the active theme. The run is isolated
from the AI console and uses plan-mode permissions, so a walkthrough can never
edit the thing it describes. Copy it, or save it into the project as Markdown.

### Debugging, tests and language servers

- **Debug Adapter Protocol** — breakpoints, step over/into/out, call stack,
  scoped variables, watch expressions, debug console. `debugpy`, `dlv`,
  `lldb-dap` and `codelldb` are pre-configured.
- **Tests** — frameworks detected from the project (go, cargo, pytest, vitest,
  jest, rspec, PHPUnit, Gradle, Maven, npm). Results appear as a grouped tree
  with pass/fail counts and durations; a green ▶ in the gutter runs one test.
- **LSP** — 24 servers pre-configured. When one is present, navigation becomes
  type-aware and you gain rename, quick fixes, formatting, inlay hints,
  signature help, and call/type hierarchy.

### Git, browser, diagrams and the AI console

- **Git** — branch picker, per-file staging, commit, history, commit viewer with
  colourised diffs, blame in the gutter, stash, revert, cherry-pick, reset.
- **Browser** — a real Chromium pane with an address bar, devtools and
  responsive presets. If a page fails to load it offers to start your dev server.
- **Diagrams** — `.nova-diagram.json` files open in a canvas editor with ten
  shapes, 50 icons, UML relationships and SVG/PNG export, or in a live Mermaid
  source editor. Six starter templates.
- **AI console** — Claude or Codex running in your project, streaming tool calls,
  with every touched file becoming a reviewable change card with a diff and a
  revert button.
- **Local history** — every overwrite snapshotted independently of Git, including
  the AI's. Browse, diff and restore any revision.
- **Ten themes** driving the whole application, and three file-icon packs.

---

## Keyboard shortcuts

| | | | |
|---|---|---|---|
| `⌘P` Go to file | `⇧⌘P` Command palette | `⇧⌘O` Go to symbol | `⇧⌘F` Search in project |
| `⌘`+click · `F12` Go to definition | `⌥F7` Find usages | `⇧F12` Peek references | `⌥⌘B` Go to implementation |
| `⌃T` Refactor This | `⇧F6` · `F2` Rename | `⌥⏎` Quick fixes | `⌥⌘L` Format document |
| `⌥⌘E` Explain this file | `⌃⌥H` Call hierarchy | `⌃H` Type hierarchy | `⇧⌘G` Source control |
| `F5` Debug start | `F10` Step over | `F11` Step into | `⇧F5` Stop |
| `⌘S` · `⇧⌘S` Save · save all | `⌘B` Toggle sidebar | `⌘J` Toggle panel | `⌘I` Toggle AI console |
| `` ⌃` `` Terminal | `⌘1…9` Jump to tab | `⌘W` Close tab | |

Refactoring bindings are listed in the [features table](#thirteen-refactorings-on-intellijs-keymap)
above. In the diagram canvas: drag to pan, `⌘`+scroll to zoom, `⌥` to bypass grid
snapping, `⌫` to delete, `⌘D` to duplicate.

---

## Architecture

The renderer has no Node access: `contextIsolation` is on, `nodeIntegration` is
off, and everything crosses a typed `window.nova` bridge. Guest pages in the
browser pane are stripped of any preload and cannot reach it at all.

```
electron/
  main.ts              window, webview policy, IPC registration
  preload.ts           the contextBridge API exposed as window.nova
  ipc/                 app · fs · git · ai · shell · indexer · lsp · debug · tests
  lib/
    parseSymbols.ts    per-language declaration extraction
    projectIndex.ts    the index engine: build, refresh, definitions, references
    lspClient.ts       JSON-RPC 2.0 over Content-Length framed stdio
    lspManager.ts      server lifecycle, document sync, request wrappers
    dapClient.ts       Debug Adapter Protocol client
    debugSession.ts    breakpoints, stepping, stack, variables, evaluate
    testFrameworks.ts  detection, command building, result parsing
    localHistory.ts    per-file revision snapshots
shared/types.ts        the IPC contract, shared by both sides
src/
  lib/refactor/        the refactoring engine — pure, no DOM, fully testable
  lib/explain.ts       the Explain prompt contract
  state/store.ts       Zustand store: tabs, buffers, git, AI, settings
  components/          sidebar · editor · diagram · browser · ai · panel
tests/                 offline suites + live-app suites driven over CDP
```

---

## Tests

```bash
npm test
```

| | |
|---|---|
| `npm run test:offline` | pure logic — declaration parsing, the symbol index, the edit applier, test-framework detection, the **76-check refactoring suite** and the Explain prompt contract |
| `npm run test:tools` | real tooling — clangd + rust-analyzer over LSP, debugpy over DAP, inlay hints, call hierarchy |
| `npm run test:ui` | **117 UI checks** driving the running app with real clicks and keystrokes over CDP — see [tests/FEATURES.md](tests/FEATURES.md) |

The UI suite asserts on rendered DOM after real input, not on store calls. It
needs the app running with a debug port:

```bash
NOVA_DEBUG_PORT=9223 npm run dev
```

```bash
npm run test:ui
```

---

## Building a distributable

```bash
npm run dist:mac
```

Also `npm run dist` for the current platform. Output lands in `release/`.

---

## Licence

Apache License 2.0 — see [LICENSE](LICENSE).

Nova bundles [Monaco](https://github.com/microsoft/monaco-editor) (MIT),
[Mermaid](https://github.com/mermaid-js/mermaid) (MIT),
[xterm.js](https://github.com/xtermjs/xterm.js) (MIT) and
[Lucide](https://github.com/lucide-icons/lucide) (ISC).
