# Feature reference

Everything Nova does, in depth. The [README](../README.md) is the tour; this is
the reference. For the test checklist that exercises each of these through the
UI, see [tests/FEATURES.md](../tests/FEATURES.md).

- [Editor](#editor)
- [Code navigation](#code-navigation)
- [Autocomplete](#autocomplete)
- [Refactoring](#refactoring)
- [Explain this file](#explain-this-file)
- [Language servers](#language-servers)
- [Debugging](#debugging)
- [Tests](#tests)
- [Git](#git)
- [Local history](#local-history)
- [Markdown](#markdown)
- [Diagram designer](#diagram-designer)
- [Built-in browser](#built-in-browser)
- [AI console](#ai-console)
- [Terminal and run configurations](#terminal-and-run-configurations)
- [Themes and settings](#themes-and-settings)

---

## Editor

Monaco — the engine behind VS Code — with grammars for every popular language
(see [`shared/languages.ts`](../shared/languages.ts)).

- Tabs with preview-on-single-click, dirty markers and middle-click close
- Go to file (`⌘P`), command palette (`⇧⌘P`), project search (`⇧⌘F`)
- Problems panel fed by Monaco diagnostics
- Bracket-pair colouring, sticky scroll, minimap, indent guides
- Multi-cursor, column selection, find/replace, folding, comment toggle — all of
  Monaco's 140 editor actions are live

Project-wide search supports match-case and regular expressions.

---

## Code navigation

The whole project is indexed on open, and that index drives IntelliJ-style
navigation with no language server involved.

| | |
|---|---|
| `⌘`/`Ctrl`+click, `F12` | Go to declaration, across files. Hold `⌘` to see the link underline first. |
| `⌥F7` | **Find Usages** — every reference in the project, grouped by file, each labelled `declaration` / `usage` / `import`. Comment and string matches sit behind a toggle. |
| `⇧F12` | Peek references inline |
| `⇧⌘O` | **Go to Symbol in Project** — fuzzy search every class, function, method, constant and global, with kind badges and containers |
| `⌃⌥H` / `⌃H` | Call hierarchy / type hierarchy (needs a language server) |

Declarations are parsed per language rather than through a language server, so
navigation works with no extra tooling and covers TypeScript/JavaScript, Python,
Go, Rust, Java, Kotlin, Scala, Swift, Objective-C, C, C++, C#, Ruby, PHP, Dart,
Elixir, Erlang, Haskell, Clojure, Lua, R, Julia, Perl, shell, PowerShell, SQL,
GraphQL, Protobuf, HCL/Terraform, Solidity, CSS/SCSS, F#, Visual Basic and
Pascal. Anything else falls back to a generic declaration pattern.

The index is incremental — the file watcher re-parses only what changed, so edits
(including the AI console's) are reflected immediately. On a 1,200-file tree it
builds in ~0.5 s and answers a find-usages query in ~20 ms.

---

## Autocomplete

Completion has two layers, so **every language gets suggestions**:

1. **Project symbols** — the index feeds Monaco a completion provider for every
   language, so typing `Order` suggests the `OrderService` class from anywhere in
   the tree, with its kind, container and source line. No tooling required.
2. **Language server** — when one is installed it takes over for its languages
   with real type awareness, and the index provider steps aside.

TypeScript/JavaScript additionally get Monaco's bundled TS worker. Word-based
suggestions from all open documents are on as well.

---

## Refactoring

Thirteen refactorings on IntelliJ's keymap, none of which need a language server.
**⌃T** opens *Refactor This* — everything that applies where the caret is, with
the rest explaining why it doesn't.

| Shortcut | Refactoring |
|---|---|
| `⌥⌘V` | Extract Variable |
| `⌥⌘C` | Extract Constant |
| `⌥⌘F` | Extract Field |
| `⌥⌘M` | Extract Method |
| `⌥⌘P` | Extract Parameter |
| `⌥⌘N` | Inline Variable |
| — | Inline Method |
| `⌘F6` | Change Signature |
| — | Introduce Parameter Object |
| `F6` | Move File |
| — | Move Class |
| — | Pull Members Up · Push Members Down |
| `⌘⌫` | Safe Delete |

Every one ends in the same preview Rename uses — the affected files, the edit
count, and a diff per file — before a byte is written, and applies through Nova's
own `WorkspaceEdit` applier so open buffers keep their undo history. Edits are
applied last-first per file and conflicting edits are refused rather than
half-applied.

### What each one does

**Extract Variable / Constant / Field** offer to replace every identical
occurrence in scope, place the declaration where the language wants it (before
the statement, after the import block, at the top of the class, in `__init__` for
Python) and use the file's own indentation. When the expression *is* the whole
statement, the declaration replaces it rather than leaving a stranded expression
behind.

**Extract Method** works out its own parameters and return value by tracking
which names the selection reads from before it and which it produces for the code
after it. Two produced values is refused rather than guessed. Inside a class it
becomes a method, with `self`/`this` handled per language.

**Extract Parameter** either gives the new parameter a default — so existing
calls keep compiling — or passes the expression explicitly at every call site,
for languages without defaults.

**Inline Variable / Method** refuse the cases that cannot be done by
substitution: a variable assigned twice, a function whose body is more than one
expression. Inlined values are parenthesised so operator precedence cannot
change.

**Change Signature** renames, retypes, reorders, adds and removes parameters,
then permutes the arguments at every call site the index knows about. New
parameters take a call-site value. The implicit receiver (`self`, `cls`, `&self`)
is hidden from the table because it is never passed — counting it would put every
reorder off by one.

**Introduce Parameter Object** folds two or more parameters into a generated
type — an `interface`, `data class`, `record`, `struct` or `@dataclass` depending
on the language — rewrites the body to read through it, and builds the object at
every call site.

**Move File** recomputes relative import specifiers across the project *and*
inside the moved file (TypeScript/JavaScript), or rewrites dotted module paths
(Python). Other languages still move, with a warning saying their imports were
left alone rather than a rename that quietly breaks the build.

**Move Class** moves a class body to another file, creating it if needed, and
adds the import back into the source file when it still uses the class.

**Pull Up / Push Down** read the hierarchy from the class header — `extends B`,
`: B`, `(B)`, `< B` — and resolve it through the symbol index.

**Safe Delete** finds every reference first and refuses while any remain, putting
them in the Usages panel; comment and string mentions are reported separately and
never block.

### How it works, and what that costs

The engine is syntax-driven, not a compiler. It masks every string literal and
comment to spaces, then scans the mask — so a brace inside `"}"`, a comma inside
`f("a,b")` and an identifier inside `// TODO: order` all stop being traps. Slices
always come from the original text.

That is why it works on any project with nothing installed, and why every result
is shown as a diff first. Fifteen languages have a full profile: TypeScript,
JavaScript, Python, Go, Java, Kotlin, C#, Rust, C, C++, Objective-C, Swift, Ruby,
PHP, Dart and Scala. Anything else gets Move File and Safe Delete — which only
move text — and the rest say so instead of guessing.

The engine is pure logic with no DOM or Electron dependency, and is covered by 76
offline checks in [`tests/test-refactor.mjs`](../tests/test-refactor.mjs).

---

## Explain this file

An **Explain** button sits at the end of the tab strip above whatever code is
open (also `⌥⌘E`, or *AI: Explain This File* in the command palette). It runs the
agent **read-only** in the project and streams back a walkthrough:

1. what it is, in one paragraph
2. the concept behind it — the algorithm, pattern or protocol it is an instance of
3. how it works, step by step, against the real identifiers
4. **system design**: a flowchart of the components, a sequence diagram of one
   full operation, plus class or ER diagrams where the file warrants them
5. a table of everything it exposes
6. the design decisions and what each one costs
7. **build it yourself** — a tutorial that reconstructs the idea from nothing
8. pitfalls, and three exercises against this codebase

Diagrams are Mermaid and render live as they arrive, in the active theme, through
the same renderer the Markdown preview uses. The prompt constrains diagram labels
because a broken fence is visible to the reader rather than silently dropped.

Two depths: **This file** on its own, or **In context**, which reads its imports,
its callers and its tests first. The result streams in as it is written, follows
the scroll until you scroll up yourself, and can be copied or saved into the
project as Markdown.

The run is deliberately isolated from the AI console: no session is resumed, no
message is added to the conversation, and it uses plan-mode permissions — a
walkthrough can never edit the thing it is describing.

---

## Language servers

When a language server is on your `PATH`, Nova speaks LSP to it and navigation
becomes *type-aware* — `service.create()` resolves to the method on that receiver
rather than every `create` in the project. Nothing is bundled and nothing is
required.

| | |
|---|---|
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
| Type hierarchy | supertypes and subtypes, where the server supports it |

Rename and multi-file quick fixes show a preview first. They apply through Nova's
own `WorkspaceEdit` applier rather than Monaco's, because the standalone editor
cannot edit files it has no model for.

24 servers are pre-configured — see
[Settings › Language servers](INSTALLATION.md#optional-language-servers) for the
list and an install command for each.

**Known limitation:** server-side commands (`workspace/executeCommand`) are not
implemented, so quick fixes that rely on one — some servers' "organize imports" —
report that instead of running.

---

## Debugging

Nova speaks the **Debug Adapter Protocol**, so any adapter on your `PATH` works:
breakpoints in the gutter, step over/into/out, call stack, scoped variables with
expandable values, watch expressions, and a debug console. `debugpy`, `dlv`,
`lldb-dap` and `codelldb` are pre-configured.

| | |
|---|---|
| `F5` | Start / continue |
| `⇧F5` | Stop |
| `F10` | Step over |
| `F11` / `⇧F11` | Step into / out |
| gutter click | Toggle breakpoint (`⌥`-click on a test line) |

**Known limitation:** breakpoints live in the main process for the app's lifetime
and are not persisted across restarts. Conditional breakpoints and log points are
not implemented.

---

## Tests

Test frameworks are detected from the project — go, cargo, pytest, vitest, jest,
rspec, PHPUnit, Gradle, Maven, or an npm `test` script. Results appear as a
grouped tree with pass/fail/skip counts, durations and failure output; a green ▶
in the gutter runs a single test. Go, cargo, pytest, jest and vitest are parsed
into per-test results; anything else still runs and streams its output.

---

## Git

Branch picker, staged/unstaged change lists with per-file stage, unstage and
discard, commit (with commit-all), full commit history, and a commit viewer with
a file list and colourised unified diff. Fetch, pull, push and stash from the
panel header; right-click any commit to revert, cherry-pick or reset onto it.

**Blame** puts per-line authorship beside the editor — click a line to open the
commit that introduced it. Working-tree changes open as a side-by-side or inline
Monaco diff. File-tree entries carry `M`/`A`/`U`/`D` decorations and the status
bar shows branch, ahead/behind and change counts.

---

## Local history

Every overwrite of a file is snapshotted, independent of Git — including the ones
the AI console makes. Right-click a file → **Local History** to browse revisions
and diff or restore any of them. Snapshots coalesce within a minute, keep 60
revisions per file, and expire after 30 days.

---

## Markdown

Split source/preview with GitHub-flavoured rendering, tables, task lists, and
**live Mermaid rendering** for ` ```mermaid ` fences. Fenced code blocks are
syntax-highlighted with Monaco, so they always match the active theme.

---

## Diagram designer

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

Six starter templates ship in the Diagrams sidebar: blank, microservices, layered
architecture, UML class diagram, sequence diagram and C4 context.

In the canvas: drag empty space to pan, `⌘`/`Ctrl`+scroll to zoom, `⌥` while
dragging to bypass grid snapping, `⌫` to delete, `⌘D` to duplicate.

---

## Built-in browser

An Electron `<webview>` pane with a real address bar, back/forward/reload,
history, per-page devtools, zoom, and responsive presets (fit / 1280 / 834 /
390). If a page fails to load it offers to detect and start your project's dev
server, then reloads the preview — so you can build UI and see it without leaving
the IDE.

Guest pages are stripped of any preload and cannot reach the `window.nova`
bridge.

---

## AI console

The right-hand panel (`⌘I`) runs a coding agent **in your project directory with
full project access**, streaming its work as it goes.

- Pick **Claude** or **Codex** — the app detects each CLI on `PATH` and shows
  install hints when one is missing
- Permission modes: auto-edit, plan-only, ask-first, full access
- Streams assistant text (rendered as Markdown), reasoning, and every tool call
  with its input and result
- **Every file the agent touches becomes a reviewable change card** with `+`/`−`
  line counts, a one-click side-by-side diff in the editor, and a revert button
- Conversations continue across turns via the CLI's own session resume

| Provider | Command |
|---|---|
| Claude | `claude -p --output-format stream-json --verbose --permission-mode <mode>` |
| Codex | `codex exec --json --skip-git-repo-check -C <cwd>` |

Changes are captured two ways so nothing is missed: edit tool events snapshot the
file immediately before and after the write, and a `git status` diff before and
after the run catches anything the agent changed by other means — a shell
command, a script it ran.

---

## Terminal and run configurations

Multiple shells in the bottom panel (`` ⌃` ``), with command history, `cd`
persistence between commands, and `⌃C` to interrupt. Run configurations are
detected from the project (npm scripts, `go run`, `cargo run`, `python`) and
appear in the run picker in the title bar.

**Known limitation:** the terminal is not a PTY. Each command runs as its own
child process with pipes, so interactive programs (`vim`, `top`, `less`,
`git rebase -i`, password prompts) do not work, and `stdout` is not a tty.

---

## Themes and settings

Ten complete themes — Nova Dark, Tokyo Night, Dracula, Nord, One Dark Pro,
Monokai Pro, Gruvbox Dark, Midnight Ocean, GitHub Light and Solarized Light. Each
drives the whole application: chrome, editor, terminal, Mermaid diagrams and
Markdown preview all change together. Three file-icon packs (Nova, Classic,
Minimal) are switchable independently.

Settings cover font size and family, tab size, word wrap, minimap, line numbers,
inlay hints, blame gutter, auto-save, format-on-save, the AI provider, model and
permission mode, the browser home page, and the icon pack. They persist to disk
and survive a reload.
