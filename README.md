<div align="center">

# Nova

**A desktop IDE that brings IntelliJ-grade code intelligence, a Chromium browser, a diagram designer and an AI pair to one window — with no language server required.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-134%20UI%20%2B%20399%20offline-brightgreen.svg)](tests/FEATURES.md)
[![Platform](https://img.shields.io/badge/platform-macOS%20%C2%B7%20Linux%20%C2%B7%20Windows-lightgrey.svg)](docs/INSTALLATION.md)

<img src="docs/screenshot.png" alt="Nova IDE — editor, project tree, symbol index and the Explain button" width="100%">

</div>

---

## What it is

Nova is a full IDE in an Electron window: the Monaco editor, a project-wide symbol
index, twenty-three refactorings, a debugger, a test runner, Git with a
three-way merge editor, a real Chromium pane, a UML/architecture diagram
designer, and an AI console wired to the `claude` and `codex` CLIs.

Two things make it unusual:

**It works with nothing installed.** The whole project is indexed on open by a
per-language declaration parser, and that index — not a language server — drives
go-to-definition, find usages, go-to-symbol, autocomplete, **rename**, code
vision, breadcrumbs and every other refactoring. Reformat Code and Optimize
Imports have their own built-in implementations too. Install a language server
and everything becomes type-aware; don't, and it still works.

**It explains itself.** An **Explain** button above any open file generates a
full walkthrough of that code — the theory behind it, a step-by-step trace,
live Mermaid system-design diagrams, and a build-it-yourself tutorial.

---

## Install

There is no download to grab — Nova is not published to a store or a release
feed, so you build it once from source. Requires **Node.js 20+**, npm and git.

### Install it as an application

Build a real desktop app and install it the way you would any other:

```bash
git clone https://github.com/byte-mods/Nova.git && cd Nova
```

```bash
npm install
```

```bash
npm run dist:mac
```

That writes `release/Nova-<version>-arm64.dmg` (and a matching `.app`). Open the
DMG and drag **Nova** to Applications:

```bash
open release
```

Or install it without the DMG step:

```bash
cp -R "release/mac-arm64/Nova.app" /Applications/
```

On an Intel Mac the folder is `release/mac/`. Use `npm run dist` for the current
platform — Windows produces an installer, Linux an AppImage.

> **macOS Gatekeeper.** The build is unsigned, so the first launch is refused
> with *"Nova is damaged"* or *"cannot be opened"*. Clear the quarantine flag
> once and it opens normally from then on:
>
> ```bash
> xattr -cr /Applications/Nova.app
> ```

### Or run it from source

For hacking on Nova itself, skip the packaging step:

```bash
npm run dev
```

Nova opens on the welcome screen — **Open folder…** points it at a project, and
it indexes the tree on open.

### Optional tooling

Nothing else is required. Language servers, debug adapters and the `claude` /
`codex` CLIs are all optional: Nova probes your `PATH` at startup, uses whatever
it finds, and lists the rest in **Settings** with an install command for each.

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

### Twenty-three refactorings, on IntelliJ's keymap

<img src="docs/refactor.png" alt="The Extract Variable preview: affected files, edit count and a per-file diff" width="100%">

**⌃T** opens *Refactor This* — everything that applies where the caret is, with
the rest explaining why they don't.

| | | | |
|---|---|---|---|
| `⇧F6` Rename | Rename File | Rename Directory / Package | `⌥⌘V` Extract Variable |
| `⌥⌘C` Extract Constant | `⌥⌘F` Extract Field | `⌥⌘M` Extract Method | `⌥⌘P` Extract Parameter |
| Extract Interface | Extract Superclass | `⌥⌘N` Inline Variable | Inline Method |
| Inline Parameter | Inline Field | `⌘F6` Change Signature | Introduce Parameter Object |
| Encapsulate Field | Invert Boolean | Convert Anonymous to Inner | `F6` Move File |
| Move Class | Pull Up · Push Down | `⌘⌫` Safe Delete | |

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

### Explain the whole project

The **Tutorial** button next to Explain (or `⇧⌥⌘E`) does the same thing at
project scale: it reads the repository and writes the technical documentation
nobody wrote while it was being built.

Nine chapters, each generated on its own or all at once as one document:

| | |
|---|---|
| **Tour** | what it is, the map, and the order to read the files in |
| **Stack** | every library and framework, its job, and what breaks without it |
| **Architecture** | processes, layers, and who may call whom |
| **Patterns** | the design patterns actually present, each with the code that proves it |
| **Algorithms** | the real algorithms and data structures, with complexity |
| **Data** | what is stored where, the schema, and the actual queries |
| **Flows** | end-to-end traces of the main operations, as sequence diagrams |
| **Security** | trust boundaries and what stops untrusted input doing damage |
| **Pipeline** | how source becomes a running app, and what the suites cannot catch |

The prompt contract is deliberately hostile to hand-waving: every structural
claim must carry a `path:line`, every technique must be named with the name you
can go and search, every decision must be paired with the cost it accepts, and
*"not present in this repository"* is a required, allowed answer. It ends with a
build-it-yourself tutorial and three exercises against your own code.

The chevron picks which assistant writes it — the two produce noticeably
different documents from the same repository, so it is a per-run choice rather
than a setting. **Save into project** writes it to `docs/TUTORIAL.md`.

### A terminal that is actually a terminal

The shell runs on a real pseudo-terminal, so `vim`, `top`, `less`,
`git rebase -i` and password prompts all work, the width follows the pane, and
Ctrl+C interrupts the foreground job rather than the shell.

### Debugging, tests and language servers

- **Debug Adapter Protocol** — breakpoints, step over/into/out, call stack,
  scoped variables, watch expressions, debug console. `debugpy`, `dlv`,
  `lldb-dap` and `codelldb` are pre-configured. Breakpoints **persist per
  project** and support **conditions, hit counts and log points**.
- **Tests** — frameworks detected from the project (go, cargo, pytest, vitest,
  jest, rspec, PHPUnit, Gradle, Maven, npm). Results appear as a grouped tree
  with pass/fail counts and durations; a green ▶ in the gutter runs one test.
- **LSP** — 24 servers pre-configured. When one is present, navigation becomes
  type-aware and you gain rename, quick fixes, formatting, inlay hints,
  signature help, and call/type hierarchy.

### The rest of the IDE

- **Find Action** (`⇧⌘P`) — every app command *and* every editor action by name,
  with its keybinding. **Recent Files** (`⌘E`), **File Structure** (`⌘F12`),
  **Bookmarks** (`F11`).
- **Split editors** (`⌥⌘→`), draggable and pinnable tabs, Close Others.
- **Replace in Path** (`⇧⌘R`) with a preview, file masks, and a **TODO** panel.
- **Explorer multi-select** (`⌘`/`⇧`-click), right-click **Find in Folder**, and
  **Safe Delete** — deleting from the tree lists what still imports it first.
- A banner when a file changes on disk under unsaved edits — Reload, Compare or
  Keep mine.

### Git, browser, diagrams and the AI console

- **Git** — branch picker, per-file staging, commit, history, commit viewer with
  colourised diffs, blame in the gutter, stash, revert, cherry-pick, reset.
- **Browser** — a real Chromium pane with an address bar, devtools and
  responsive presets. If a page fails to load it offers to start your dev server.
- **Diagrams** — `.nova-diagram.json` files open in a canvas editor with ten
  shapes, 50 icons, UML relationships and SVG/PNG export, or in a live Mermaid
  source editor. Six starter templates.
- **AI console** — Claude, Codex, or a **local model** via OpenCode + Ollama
  running in your project, streaming tool calls,
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
| `⌥⌘E` Explain this file · `⇧⌥⌘E` Explain the project | `⌃⌥H` Call hierarchy | `⌃H` Type hierarchy | `⇧⌘G` Source control |
| `F5` Debug start | `F10` Step over | `F11` Step into | `⇧F5` Stop |
| `⌘S` · `⇧⌘S` Save · save all | `⌘B` Toggle sidebar | `⌘J` Toggle panel | `⌘I` Toggle AI console |
| `` ⌃` `` Terminal | `⌘1…9` Jump to tab | `⌘W` Close tab | `⌥⌘→` Split editor |
| `⌘E` Recent files | `⇧⌘E` Recent locations | double `⇧` Search everywhere | `⌘F12` File structure |
| `F11` Toggle bookmark | `⇧⌘R` Replace in path | `⌥⌘L` Reformat code | `⌃⌥O` Optimize imports |
| `⌥F9` Run to cursor | `⌘F8` Toggle breakpoint | `⌥⌘R` Record macro | `⇧⌥⌘R` Play macro |

Every one of these is rebindable in **Settings › Keymap**.

Refactoring bindings are listed in the [features table](#twenty-three-refactorings-on-intellijs-keymap)
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
| `npm run test:offline` | **399 checks** of pure logic — declaration parsing, the symbol index, the edit applier, test-framework detection, the **100-check refactoring suite**, the formatter and Optimize Imports, EditorConfig resolution, batch inspections, postfix completion, the SQL helpers, the generated diagrams, run-config composition, and the Explain and Tutorial prompt contracts |
| `npm run test:tools` | real tooling — clangd + rust-analyzer over LSP, debugpy over DAP, inlay hints, call hierarchy. Skipped tools are reported, not silently passed |
| `npm run test:ui` | **134 UI checks** driving the running app with real clicks and keystrokes over CDP — see [tests/FEATURES.md](tests/FEATURES.md) |

Two more live-app suites run separately: `node tests/verify-explorer.mjs` (20
checks over multi-select, scoped search and Safe Delete) and
`node tests/verify-tutorial.mjs` (22 over the project tutorial).

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
