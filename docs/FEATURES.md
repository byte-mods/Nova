# Feature reference

Everything Nova does, in depth. The [README](../README.md) is the tour; this is
the reference. For the test checklist that exercises each of these through the
UI, see [tests/FEATURES.md](../tests/FEATURES.md).

- [Editor](#editor)
- [Code navigation](#code-navigation)
- [Search, replace and TODOs](#search-replace-and-todos)
- [Explorer selection and safe deletion](#explorer-selection-and-safe-deletion)
- [Search Everywhere and scopes](#search-everywhere-and-scopes)
- [Autocomplete](#autocomplete)
- [Formatting and imports](#formatting-and-imports)
- [Refactoring](#refactoring)
- [Explain this file](#explain-this-file)
- [Explain the whole project](#explain-the-whole-project)
- [Local models (OpenCode + Ollama)](#local-models-opencode--ollama)
- [Language servers](#language-servers)
- [Debugging](#debugging)
- [Tests](#tests)
- [Git](#git)
- [Local history](#local-history)
- [Markdown](#markdown)
- [Diagram designer](#diagram-designer)
- [Built-in browser](#built-in-browser)
- [UI testing](#ui-testing)
- [Security scanning](#security-scanning)
- [Sharing a session](#sharing-a-session)
- [AI console](#ai-console)
- [Terminal and run configurations](#terminal-and-run-configurations)
- [Project structure](#project-structure)
- [Themes and settings](#themes-and-settings)
- [Keymap and macros](#keymap-and-macros)
- [Scratch files](#scratch-files)
- [Plugins](#plugins)
- [Inspections](#inspections)
- [Structural search and live templates](#structural-search-and-live-templates)
- [Test coverage](#test-coverage)
- [Profiler](#profiler)
- [Build tools](#build-tools)
- [Request client](#request-client)
- [Database console](#database-console)
- [Docker, Kubernetes and SSH](#docker-kubernetes-and-ssh)

---

## Editor

Monaco — the engine behind VS Code — with grammars for every popular language
(see [`shared/languages.ts`](../shared/languages.ts)).

- Tabs with preview-on-single-click, dirty markers and middle-click close
- Go to file (`⌘P`), command palette (`⇧⌘P`), project search (`⇧⌘F`)
- Problems panel fed by Monaco diagnostics
- Bracket-pair colouring, sticky scroll, minimap, indent guides
- Multi-cursor, column selection, find/replace, folding, comment toggle — all of
  Monaco's 140 editor actions are live, and every one is reachable by name from
  **Find Action** (`⇧⌘P`)
- **Split editors** (`⌥⌘→`): two groups side by side, each with its own tab
  strip and active tab. Drag a tab between them, or use the tab context menu.
- Tabs can be **reordered by dragging**, **pinned** so Close Others spares them,
  and closed in bulk — Close Others, Close to the Right — from a context menu

**Breadcrumbs** run above the editor: the file's path segments, then the chain
of symbols containing the caret (`src › store.ts › OrderService › submit`). Each
segment is clickable. They come from the symbol index, so they work with no
language server, and can be turned off in Settings › Editor.

**Code vision** puts a usage count above every class, interface and function —
clicking it opens Find Usages for that symbol. Counts come from the index and are
cached per document version, so scrolling costs nothing.

A file changed on disk while its buffer has unsaved edits raises a banner
offering **Reload from disk**, **Compare** or **Keep mine**, so a later save is a
decision rather than an accident.

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
| `⌘E` | **Recent Files** — the MRU list |
| `⇧⌘E` | **Recent Locations** — the caret positions you actually worked at, newest first, each with its source line |
| double `⇧` | **Search Everywhere** — files, symbols, actions and full-text matches in one list |
| `⌘F12` | **File Structure** — this file's symbols, filterable |
| `F11` / `⇧F11` | Toggle a **bookmark** / list them all |
| `⇧⌘P` | **Find Action** — every app command *and* every editor action, with its keybinding |
| — | **History for Selection** — `git log -L` over the selected lines, from the editor context menu |

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

## Search, replace and TODOs

**Find in Project** (`⇧⌘F`) searches the whole tree with match-case and regex
toggles, results grouped by file and collapsible per file. **Replace in Path**
(`⇧⌘R`) recomputes every replacement against the real file contents — the
backend reports one hit per matching *line*, not per occurrence — and routes the
result through the same preview and applier a refactoring uses, so a
project-wide rewrite is seen as a diff before a byte is written. Regex captures
(`$1`) work in the replacement.

The **TODO** panel collects `TODO`, `FIXME`, `HACK` and `XXX` from comments
across the project, so unfinished work is a list rather than something you have
to remember to grep for.

### Searching one folder

Right-click any file or folder in the Explorer:

- **Find in Folder…** opens Search with the file mask already set to that
  subtree, so the only thing left to type is what you are looking for.
- **Find File by Name…** opens the file finder pre-filtered to the same folder.

Both hand the scope over through the store rather than a DOM event, because the
Explorer switches pane and seeds the scope in a single action — an event would be
dispatched before the receiving pane had mounted.

---

## Explorer selection and safe deletion

**Multi-select.** `⌘`/`Ctrl`-click toggles a row; `⇧`-click extends a contiguous
range over the rows currently visible; a plain click collapses back to one and
does the usual thing. The modified forms deliberately do not open anything —
selecting five files to delete should not open five tabs. A count bar appears
above the tree once more than one row is selected.

Selection is separate from "which file is open": a row can be both the open file
and part of a selection, so the picked state is a left marker and a wash rather
than a background colour that would hide the other.

**Safe Delete.** Deleting from the tree used to call `fs.trash` immediately — the
one destructive action in the IDE with no preview in front of it. It now goes
through the same gate every refactoring has:

1. A directory is expanded to the files underneath it, so the check sees exactly
   what the disk will.
2. For each file, the index is asked for every declaration it makes, then for
   every reference to those declarations from somewhere **not also being
   deleted** — removing a module together with its only consumer is not a
   dangling reference, and is not reported as one.
3. The confirmation lists what would break, with file and line, and deleting
   anyway requires ticking an explicit override.

Comment and string mentions are excluded: they cannot break a build, and
including them made the warning noisy enough to ignore.

Files the index has no declarations for — assets, markdown, a language with no
parser profile — are reported as **could not be checked** rather than folded into
"nothing refers to these". The two must not read the same way in a delete
confirmation.

---

## Search Everywhere and scopes

Tap **shift twice** for Search Everywhere: one field that asks the file finder,
the symbol index, the action registry and the full-text search at once, and
shows the best few of each under group headings. Full-text joins in from three
characters — shorter needles produce thousands of hits and drown the useful
groups. With the field empty it lists recent files, which is what a reflexive
double-shift usually wants. The four specific finders (`⌘P`, `⇧⌘O`, `⇧⌘P`,
`⇧⌘F`) are unchanged, and Tab cycles between every mode including this one.

**Recent Locations** (`⇧⌘E`) lists the caret positions you actually worked at,
with the source line at each — adjacent positions in a file merge into one
entry, because a location is a place you worked rather than every line the caret
passed through.

**Custom scopes.** Find in Project's file mask supports exclusions (`!**/*.test.*`)
as well as inclusions, and any mask can be saved as a named scope from the
bookmark button beside it. Two ship by default — *Production code* and *Tests
only* — and they are ordinary settings, so a project convention can be added
once and reused.

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

**Auto-import on completion.** Picking an exported symbol declared in another
file also inserts the import for it — a relative specifier for
TypeScript/JavaScript, a dotted `from x import y` for Python — placed after the
existing import block. The completion item says which module it will import
from, and languages whose import path cannot be derived from the file path just
insert the name, as before.

**Parameter info without a language server.** Inside a call, the enclosing
function name is resolved through the index and its declaration line shown as
signature help, with the active argument highlighted. A running language server
still wins.

**Postfix completion.** Type an expression, a dot, then a template name and the
expression is wrapped rather than dereferenced:

| Typed | Becomes |
|---|---|
| `user.isAdmin.if` | `if (user.isAdmin) { … }` |
| `items.for` | `for (const item of items) { … }` |
| `response.var` | `const value = response` |
| `err.notnull` | `if (err != null) { … }` |
| `value.log` | `console.log(value)` |

The expression is read backwards with a bracket-aware scan, so `items[0].name.log`
wraps `items[0].name`. Templates exist for TypeScript/JavaScript, Python, Go,
Java/Kotlin/C#/Scala and Rust, each in that language's own idiom.

---

## Formatting and imports

**Reformat Code** (`⌥⌘L`) picks the best formatter available, in order: the
language server's, then Monaco's own (a real printer for the web languages it
bundles), then Nova's built-in one. That last step is what makes the shortcut do
something for Go, Rust, Java and the rest with nothing installed.

The built-in formatter has no parser and does not pretend to: it *normalises*
rather than re-flows. It normalises spacing around `,` and `;`, trims trailing
whitespace, collapses runs of blank lines, and fixes the final newline and line
endings. It never wraps, re-orders or moves a brace, and it never touches
indentation in a language where indentation is syntax. All of it runs on masked
text, so a brace inside a string is not a brace.

It can also **re-indent by bracket depth** — a wrapped argument list indents one
step and `}` lands under its opener — but that is the one step it does *not* do
by default. Re-indenting an entire file rewrites lines the author deliberately
aligned, so it ships off and is a tick in **Settings › Code style › Re-indent**;
everything above applies either way.

**Optimize Imports** (`⌃⌥O`) drops imports whose bound names never appear in the
file and puts what remains in a predictable order — external modules first, then
project-relative, alphabetically within each group. It knows what each statement
*binds*, which is the only per-language part: `import { a as b }` binds `b`,
`import a.b.C` binds `C`, `import "os"` binds `os`. Supported for
TypeScript/JavaScript, Python, Go, Java/Kotlin/Scala, C#, PHP, Rust and Dart;
Swift and the C family are sorted but never pruned, because a bare `import
Foundation` brings in a namespace the engine cannot track. Side-effect imports
and wildcards are never removed, and a comment attached to an import travels
with it. Only the contiguous block at the top of the file is reordered — a lazy
`require` further down is deliberate and is left where it is.

**Code style** lives in Settings › Code style: indent size and tabs, max line
length, blank lines to keep, line endings, import order and grouping,
format-on-save and optimize-imports-on-save.

**EditorConfig** overrides the scheme per file. Nova walks from the file's
directory up to the project root (or the first `root = true`), matches every
section glob — including `**`, `{a,b}` and `[abc]` — and lets nearer files win,
which is the spec's own resolution model. A repo that ships `.editorconfig` has
already decided, and its decision beats the user's personal preference.

---

## Refactoring

Twenty-three refactorings on IntelliJ's keymap, none of which need a language
server. **⌃T** opens *Refactor This* — everything that applies where the caret
is, with the rest explaining why it doesn't.

| Shortcut | Refactoring |
|---|---|
| `⇧F6` | Rename |
| — | Rename File · Rename Directory / Package |
| `⌥⌘V` | Extract Variable |
| `⌥⌘C` | Extract Constant |
| `⌥⌘F` | Extract Field |
| `⌥⌘M` | Extract Method |
| `⌥⌘P` | Extract Parameter |
| `⌥⌘N` | Inline Variable |
| — | Inline Method |
| `⌘F6` | Change Signature |
| — | Introduce Parameter Object |
| — | Extract Interface · Extract Superclass |
| — | Inline Parameter · Inline Field |
| — | Encapsulate Field |
| — | Invert Boolean |
| — | Convert Anonymous to Inner |
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

**Rename** is the one that used to need a language server, and no longer does.
It resolves the symbol through the index, then re-derives every occurrence from
the text it is about to rewrite — never from the index's recorded columns, so an
unsaved buffer cannot shift an edit onto the wrong token. Two things keep it
honest rather than a project-wide find/replace:

- **Scope is narrowed by default.** A name with no *exported* declaration, or
  one the index has never seen declared at all (locals and parameters are not
  indexed), is renamed inside its own file. The dialog says why, and offers a
  checkbox to widen it.
- **Comments and strings are separate.** Occurrences that do not survive literal
  masking are counted, listed and left alone unless asked for.

When the file is named after the symbol it offers to rename the file too,
recomputing the imports that pointed at it. `⇧F6` opens the dialog; `F2` does
the same rename in place through Monaco's inline widget.

**Rename Directory / Package** moves the whole subtree in one filesystem rename
and recomputes every relative and dotted import that crossed it — also available
from the Explorer's context menu.

**Extract Interface / Extract Superclass** read a class's methods and fields off
the file, let you tick which to lift, and write the new type either above the
class or into its own file. Each language contributes how it spells the thing —
`interface`, `protocol`, `trait`, `class …(Protocol)` — and how a class declares
conformance (`implements`, `extends`, `: Base`, a Python base list), so the
header is rewritten correctly rather than with Java syntax pasted into Ruby. Go
says structural typing needs no declaration; Rust says it needs an `impl` block
it did not write.

**Encapsulate Field** makes the field private, generates the accessor pair in
the language's own idiom (get/set methods, or a `@property` pair for Python and
a getter/setter for Dart), and rewrites reads and writes in the declaring file.
`this.n = this.n + 1` is handled as one setter call with the read folded into
its argument, rather than two overlapping edits.

**Invert Boolean** renames the symbol to its opposite, negates the returns or
the initializer, and wraps every usage in a negation — cancelling an existing
`!` rather than doubling it. Comparisons are flipped (`===` → `!==`, `>` → `<=`)
when they are the whole expression; anything with a top-level `&&`/`||` is
parenthesised instead of being mangled by half-applied De Morgan.

**Inline Parameter** checks that every call site passes the same expression,
refuses with the differing values listed if they do not, then removes the
parameter and introduces a local at the top of the body.

**Inline Field** replaces reads of a field with its initializer and removes the
declaration — refusing outright if the field is assigned anywhere else.

**Convert Anonymous to Inner** turns `new Runnable() { … }` (or Kotlin's
`object : Runnable(…) { … }`) into a named class, nested in the enclosing class
or beside it. Captured locals are listed as a warning, because they need to
become constructor parameters and the engine will not guess at that.

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
PHP, Dart and Scala. Anything else gets Rename, Move File and Safe Delete —
which only move text, and mask with a generic comment/quote profile — and the
rest say so instead of guessing.

The engine is pure logic with no DOM or Electron dependency, and is covered by
100 offline checks in [`tests/test-refactor.mjs`](../tests/test-refactor.mjs).

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

## Explain the whole project

A **Tutorial** button sits beside Explain (also `⇧⌥⌘E`, or *AI: Explain This
Whole Project* in the palette). Where Explain documents one file, this documents
the application: the libraries it stands on, its architecture, the patterns it
instantiates, the algorithms inside it, how it talks to a database, how a click
travels to the disk and back, and how it is built and shipped.

Why it exists: a codebase assembled with an agent is readable line by line and
opaque as a system. The prompt history records *what* was asked for and nothing
about *why* the result is shaped this way — which is exactly the knowledge needed
to change it safely.

### The chapters

| Chapter | What it answers |
|---|---|
| **Tour** | What it is, a table of every directory, and a numbered reading order of the 8–12 files that carry the design |
| **Stack** | Every dependency with its version, job, call sites and what breaks without it; the frameworks' mental models; what was chosen over what |
| **Architecture** | Process and trust model, the layer table with who-may-call-whom, the typed contract between layers, and where the structure strains |
| **Patterns** | Only the patterns genuinely present, each with the general idea, the citation, what it buys and what it costs; plus local idioms and honest debt |
| **Algorithms** | The real techniques named canonically, the data structures and why those, complexity against real input sizes, invariants and failure modes |
| **Data** | What is stored where, the schema with an ER diagram, the actual quoted queries, and only the DB concepts this code depends on |
| **Flows** | Four to six operations traced end to end — trigger, every hop with file and line, a sequence diagram, failure modes, and the one subtlety |
| **Security** | The threat model this project actually has, the trust-boundary table, the defences quoted from source, and what is out of scope |
| **Pipeline** | Source to shipped artefact stage by stage, the build settings that change how code must be written, and what each suite *cannot* catch |
| **Everything** | All nine in one document — the one to save into the repository |

### The contract

The prompt is deliberately hostile to hand-waving, and the rules are repeated
into every chapter because a single instruction at the top of a long document
stops being obeyed halfway down it:

- every structural claim carries a `path/to/file.ts:123`
- identifiers are quoted exactly; no illustrative-but-fictional APIs
- techniques are named with the name a reader can go and search
- every decision is paired with the cost it accepts
- **"not present in this repository"** is a required, allowed answer — an absence
  is a finding, not a failure

Each chapter closes with a build-it-yourself tutorial that reconstructs the core
idea from an empty directory, three exercises against your own repository (at
least one that *breaks* something instructively), and five things not to forget.

### Using it

The chevron beside the button chooses which assistant writes it. That is a
per-run choice rather than a setting because the two CLIs produce noticeably
different documents from the same repository, and comparing them is worth more
than picking one for ever. The same menu starts any single chapter.

The document streams in as it is written, with a contents rail built from the
headings that have arrived so far, so a long document is navigable while it is
still being generated. It keeps running if you switch tabs. **Save into project**
writes it to `docs/TUTORIAL.md` (or `docs/TUTORIAL-<chapter>.md`).

Like Explain, the run is isolated from the AI console and uses plan-mode
permissions — the document can never edit its subject.

---

## Local models (OpenCode + Ollama)

A third provider sits beside Claude Code and Codex: **OpenCode (local)**. It is an
agent CLI like the other two, but it points at whatever model you configure —
including one running locally under [Ollama](https://ollama.com). Everything that
uses the assistant works through it: the AI console, Explain, and the project
Tutorial. No account, no network, no per-token cost.

```bash
npm i -g opencode-ai
```

```bash
ollama pull qwen2.5-coder:0.5b
```

Then pick **OpenCode (local)** in Settings › AI console, or from the provider
dropdown in the console itself. The **Model override** field offers the models
Ollama has actually pulled as autocomplete suggestions, so it is not a guessing
game about spelling and tags. A bare name like `qwen2.5-coder:0.5b` is read as an
Ollama model; write `provider/model` to reach anything else OpenCode knows about.

Small models are genuinely useful for the read-only work — Explain and the
Tutorial chapters — and struggle with multi-step editing, where tool-calling
accuracy matters more than fluency. Start small and move up only if you need to.

### How it differs from the hosted providers

| | |
|---|---|
| **Permissions** | OpenCode asks before anything destructive and *auto-rejects* when it cannot ask. Plan mode is therefore the absence of `--auto` plus its built-in read-only `plan` agent; every other mode passes `--auto`, since without it every write is refused. |
| **Streaming** | Message parts arrive **completed** rather than token by token, so a long answer lands in one update. The console renders it the way it renders Codex. |
| **Completion** | There is no terminating event in the stream — the CLI exits when its session goes idle, so the run is finished by the process closing. |
| **Change cards** | A tool part is only reported *after* it has run, so there is no moment at which the pre-edit file can be snapshotted. Change cards for this provider are reconstructed from git HEAD when the run ends, which means **a project that is not a git repository shows the edits in the transcript but produces no reviewable change cards.** |

A failed run with no models pulled reports that specifically, rather than passing
through OpenCode's own "Unexpected server error", which says nothing useful.

The argument builder and the stream translator are pure functions in
[`electron/lib/opencode.ts`](../electron/lib/opencode.ts) with 38 offline checks,
because both fail *silently* when wrong — a bad flag is ignored by the CLI and a
bad translation renders an empty console.

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

Code actions that resolve to a server-side command run through
`workspace/executeCommand`; the server does the work and pushes the result back
as a `workspace/applyEdit`, which Nova applies like any other edit.

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
| `⌥F9` | Run to cursor |
| `⌘F8` | Toggle breakpoint at the caret |
| gutter click | Toggle breakpoint (`⌥`-click on a test line) |

Breakpoints **persist per project** and come back when you reopen it. Right-click
one in the gutter for its properties:

| | |
|---|---|
| **Condition** | suspend only when an expression is true, evaluated in the frame's scope |
| **Hit count** | `>5`, `%3`, `=10` — support varies by adapter |
| **Log message** | turns it into a **log point**: prints and does *not* suspend. `{expr}` interpolates |
| **Enabled** | mute it without losing the condition |

Each kind is distinct in the gutter: a red dot for a plain breakpoint, amber for
a conditional one, a blue diamond for a log point, and a hollow ring when muted.

### Breakpoints panel

The debugger's **Breakpoints** tab gathers the three things that can suspend a
program:

- **Line breakpoints** — every one in the project, with its condition or log
  marker, clickable to jump there, tickable to mute.
- **Exception breakpoints** — the adapter declares which categories it can break
  on (`raised`, `uncaught`, `assert`…) during `initialize`, and Nova sends the
  chosen ones back. Break-on-throw genuinely works now; the selection persists
  per project alongside the line breakpoints, and adapters supporting exception
  conditions get a condition field.
- **Watchpoints** — right-click a variable while paused to break when the
  program *writes* to it. The adapter turns the variable into an opaque data id
  first, which is only valid for that session, so watchpoints are deliberately
  not persisted.

### While suspended

**Run to Cursor** (`⌥F9`) continues but stops at the caret, implemented as a
one-shot breakpoint that is withdrawn as soon as the program stops — not DAP's
`goto`, which *skips* the code in between and is a different feature.

**Drop Frame** re-enters the selected frame from its first line, for adapters
that implement `restartFrame`.

**Variable values are editable**: double-click one in the Variables tree and
type. `setVariable` is tried first and `setExpression` as a fallback, since
adapters implement one, the other or both.

---

## Tests

Test frameworks are detected from the project — go, cargo, pytest, vitest, jest,
rspec, PHPUnit, Gradle, Maven, or an npm `test` script. Results appear as a
grouped tree with pass/fail/skip counts, durations and failure output; a green ▶
in the gutter runs a single test. Go, cargo, pytest, jest and vitest are parsed
into per-test results; anything else still runs and streams its output.

- **Rerun failed** takes the failures of the last run and reruns exactly those,
  folded into each runner's own filter syntax — an anchored regex union for
  `go test -run`, `-t` for jest/vitest, `-k` for pytest, repeated `--tests` for
  Gradle, and so on.
- **Run with coverage** appends the framework's coverage flags to the same run
  and loads the report it produces when the run finishes. A framework with no
  coverage mode Nova knows says so and runs without it rather than silently
  producing nothing.
- **History** keeps the last twenty finished runs of the session in a dropdown,
  so a run can be compared against the one before it without re-running.

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

### Commit graph

The history list draws a real graph: lanes are assigned as the log is walked,
merges collapse into the lane they came from and branches fork out, each lane
coloured. Parent hashes come straight from `git log --format=%P`, and the log is
read with `--all` so branches other than the current one are visible.

### Merge conflicts

Conflicted files get their own section in the Git view; clicking one opens the
**three-way merge editor** — yours on the left, theirs on the right, the result
as a live editor in the middle. The three sides come from git's own index stages
(`:1:`, `:2:`, `:3:`), so nothing has to be re-merged or scraped out of conflict
markers. Hunks where only one side changed are resolved automatically; the rest
are listed as decisions with *Take yours* / *Take theirs* / *Take base*, and the
result stays editable by hand. **Apply** writes the file and `git add`s it.
Rebases can be continued or aborted from the same section.

### Shelve and changelists

**Shelve** saves a patch of the selected changes under `.nova/shelf/` and takes
the files back to HEAD; **Unshelve** applies it with a three-way merge. A patch
on disk rather than a stash entry, because a stash is a commit on a hidden ref
that can only be replayed in order — a shelf can be applied whenever, in any
order, on any branch.

**Changelists** group local modifications into named buckets, stored in
`.nova/changelists.json` rather than in git: a changelist is a way of *looking
at* uncommitted work, so a file drops out of one the moment it stops being
modified. Right-click any change to move it.

### Interactive rebase

**Rebase…** builds the same plan `git rebase -i` would open in an editor —
pick / reword / squash / fixup / edit / drop, reorderable — and runs it by
pointing `GIT_SEQUENCE_EDITOR` at the todo file Nova wrote. Rewording needs no
message editor: it becomes `pick` followed by `exec git commit --amend -m …`,
with the new message typed in the dialog. Conflicts drop into the merge editor
above.

### History for Selection

Select some lines, then **Git: History for Selection** in the editor context
menu: `git log -L` traces exactly those lines through renames and reindentations,
and the tab shows each commit that touched them with its diff of that range.

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

### Generated from code

Three diagrams are generated from the project rather than drawn, from the
**Generate from code** buttons in the Diagrams sidebar. Each writes a Markdown
file under `.nova/diagrams/` — diffable, checkable into git, and overwritten on
regeneration, so the diagram stays a build artifact of the code instead of
drifting into a hand-edited copy.

- **UML class diagram** — classes, interfaces, enums and their members from the
  symbol index, with inheritance edges read off each class's own declaration
  line. Ranked by how much is known about each type, capped so mermaid stays
  readable.
- **Module dependency graph** — which top-level modules import which, counted
  from real import statements (relative specifiers, `@/` aliases and Python
  dotted modules), with the count on each edge.
- **Dependency structure matrix** — the same graph as a matrix, rows depending
  on columns, with every cycle marked `⚠` and listed underneath.

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

---

## UI testing

The browser pane is not only for looking at your app — it can watch what you do
in it and write the test.

### Recording

**Record** in the browser toolbar injects a recorder into the page. Click, type,
tick, select; **Save** writes it out as a Playwright spec under `e2e/`.

Playwright's syntax rather than a format of Nova's own, deliberately: the point
of recording is to get a test into the suite the project already runs. A
bespoke format would need a bespoke runner, and the recording would only ever
be useful inside this editor.

A raw capture is a transcript — every keystroke its own step, and the click
that focused a field in front of them — so it is collapsed before it is
written. What comes out reads like something a person typed:

```ts
import { test, expect } from '@playwright/test'

test('records a user flow', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Email').fill('ada@example.com')
  await page.getByLabel('Password').fill('hunter2')
  await page.getByLabel('Remember me').check()
  await page.getByTestId('submit').click()
})
```

### Which selector it picks

The locator is chosen for **durability**, which is the whole reason a recorder
beats writing selectors by hand:

1. a test id (`data-testid`, `data-test`, `data-qa`) — survives a redesign
2. a role with its accessible name — survives a class rename
3. a label, then a placeholder
4. the element's own text
5. an id, if it does not look generated — `#user-42` and hash-like ids are
   skipped, because they change on the next build
6. a scoped CSS path, last

Two rules bend that order, and both come from what actually breaks at replay
time. A **unique weak** locator beats an **ambiguous strong** one — `.first()`
on a role that matched four buttons is a coin toss. And a role with no
accessible name loses to a label, because `getByRole('checkbox')` is unique
right up until the page grows a second checkbox.

### Inspecting

**Pick** highlights whatever is under the cursor and reports the selector a test
would use for it, without clicking anything — inspecting a "Delete" button must
not delete something. The strip shows the locator and whether it matched more
than one element.

### Visual regression

**Capture** compares the page with its stored baseline, or creates one if there
is none. Baselines live in `e2e/__screenshots__/` **in the project**, not in
application data: a screenshot saying "this is what the page should look like"
is a reviewable artefact and belongs in the same commit as the change that
altered it.

A failure writes a diff image beside the baseline — the old page dimmed, with
changed pixels in magenta, so it is legible rather than a field of colour. The
comparison is a pixel walk with a small per-channel tolerance, which absorbs
font and gradient dithering without deciding for you which differences matter.
A first run reports "baseline captured" rather than a pass, so a suite that
never had baselines cannot look green forever.

The page has to be visible to be captured. A `<webview>` produces no frames
while it is hidden, and its own `capturePage()` never settles — the capture goes
through the guest's debugger with a screencast, which asks for a frame instead
of waiting for one.

### Running E2E suites

Playwright and Cypress are detected like any other test framework, so their
suites run in the **Tests** panel alongside the unit tests, with per-test
results and Rerun Failed. Playwright reports nest project, file and `describe`
blocks arbitrarily deep; the tree is walked rather than read at two fixed
levels, so a nested suite is not silently empty.


---

## Security scanning

The **Security** panel scans the open project three ways and reports one list.
Nothing leaves the machine except the dependency check, which sends package
names and versions to the advisory database and nothing else — no source, no
paths, no findings.

### Code

Pattern rules for the vulnerability classes that recur: SQL and command
injection, `eval`, path traversal, XSS through `innerHTML` and
`dangerouslySetInnerHTML`, wildcard CORS, disabled CSRF, MD5 and SHA-1, ECB and
DES, disabled TLS verification, `Math.random` used for a token, unsafe
deserialization, unverified JWTs, debug mode, and plaintext HTTP endpoints.
Each carries its CWE and a fix.

These are patterns, not dataflow, and the panel says so: **no code rule is ever
reported as confirmed.** A pattern can see a query built by concatenation; it
cannot see whether the value came from a request or a constant three files
away. Reporting matches as facts is how a security tool loses its audience —
two hundred findings that are mostly wrong get dismissed wholesale, including
the four that were right.

Rules are skipped inside comments, and `// nova-ignore`, `nosec` and
`nosemgrep` suppress a line or the line beneath.

### Secrets

Two kinds of rule, deliberately different in character. **Known formats** — AWS
key ids, GitHub, Slack, Stripe, Google, OpenAI and Anthropic keys, private-key
headers, JWTs, connection strings with a password — have shapes nothing else
has, and are reported as **confirmed**. **Assignment plus entropy** —
`apiKey = "…"` where the value looks random — is never better than *likely*,
because a long random string is also what a hash, a UUID and a checksum look
like.

UUIDs, digests, versions, paths, template placeholders and `.env.example` files
are handled explicitly rather than left to an entropy threshold. Everything
reported is **redacted** before it is displayed, keeping only the last four
characters — enough to match against a provider's dashboard, which lists key
suffixes for exactly this purpose.

### Dependencies

Lockfiles are read — npm, pnpm, yarn, pip, poetry, Cargo, Go, Bundler and
Composer — and every pinned version is checked against
[OSV.dev](https://osv.dev), which aggregates GitHub's database, the ecosystems'
own, and the CVE feeds. A lockfile rather than a manifest, because a manifest
range cannot be matched against an advisory without resolving it.

This is the one thing the scanner reports as **confirmed**: a version sitting
inside a published affected range is a fact, not a pattern. Each finding links
its advisory and names the version to upgrade to. With no network the phase
says so rather than quietly reporting nothing.

### Reading the results

Findings are ordered worst-first, and within a severity the ones that can be
trusted first — a confirmed medium is worth more of an afternoon than a
possible high. Confidence is spelled out in words next to each one, because
"possible" beside a critical severity has to read as a caveat rather than a
label.


---

## Sharing a session

The **Share** button in the title bar gives the current session a public
address, so someone else can look at it without installing anything. A local
server is fronted by a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-tunnel/)
— outbound only, so it needs no account, no DNS, no port forwarding and no
inbound firewall rule. It requires `cloudflared` on the PATH:

```bash
brew install cloudflared
```

Two things can be shared, and they are deliberately separate — sending someone
an API collection should not also hand them the source tree.

**The project.** A read-only view that follows the file you have open. Viewers
browse the tree and watch the editor move as you work; the content is pushed
over Server-Sent Events, and a viewer who clicks something themselves stops
following rather than having the page yanked around.

**A request collection.** With a `.http` file open, publish just that: the
requests, their methods, URLs, headers and bodies, with `Authorization`,
`Cookie` and `X-Api-Key` masked and file variables listed by name only. A
`@token = …` line stays a name, never a value.

### Live audio and video

Either kind of share can also carry the presenter. In the dialog, tick any
combination of **Screen**, **Camera** and **Microphone**, pick which screen or
window if you chose Screen, and press **Go live**. Everyone holding the link
sees and hears it in their browser — no account, no install, no plugin, and no
second tool to arrange.

The three are independent. A voice-only walkthrough of a shared project is a
normal thing to want, and so is a silent screen. Screen and camera together
arrive as a main view with the presenter inset, because the alternative —
compositing them here — would bake a layout decision into the stream that the
viewer cannot undo.

**How it travels.** Capture runs in the renderer, `MediaRecorder` encodes to
WebM, and the main process fans the segments out to viewers over the tunnel that
is already open. WebRTC would cut the delay to a fraction, but only with a
signalling path and a STUN/TURN server behind it — infrastructure that someone
who typed `brew install cloudflared` has not agreed to run. This costs about a
second of latency and needs nothing.

Each request for media answers and **ends**, rather than one response held open
for the length of the broadcast. That matters more than it sounds: proxies and
scanning middleboxes routinely buffer a response until it completes, and on such
a network a held-open stream delivers the whole broadcast in one lump at the
end. A reply that finishes is forwarded immediately by everything in the path.
The viewer page polls for the same reason, with Server-Sent Events as the fast
path where they work.

**What a late arrival gets.** The header the stream is decoded against is kept
and handed to whoever joins next, followed by the live edge — so someone who
opens the link ten minutes in starts watching immediately rather than staring at
a player that cannot interpret what it is being sent.

Nothing is recorded. A few seconds of recent media is held in memory so a viewer
can catch up, and it is discarded when the broadcast stops. **Stop the
broadcast** ends the audio and video and leaves the shared page up; **Stop
sharing** takes down everything.

On macOS the first broadcast triggers the system prompts for Screen Recording,
Camera and Microphone. The capture also needs the window on screen — a fully
occluded window produces no frames for the compositor to hand over.

### What it exposes, and what it does not

The share server is the thing that ends up on the public internet, so it is
built around what it *cannot* do:

- **No writes.** There is no endpoint that mutates anything — not gated behind
  a permission, simply absent. A `POST` is refused before a path is considered.
- **A token in every path.** 32 hex characters, new for each share. Without it
  every route is a 404, including the index, so the URL is the whole credential
  and a scan of `trycloudflare.com` finds nothing.
- **Rooted path resolution.** Every read is resolved and confirmed to still sit
  under the project root, so `..`, an absolute path, an encoded traversal and a
  symlink all fail.
- **Secrets withheld.** `.env` files, `.npmrc`, `.netrc`, private keys,
  certificates and keystores are refused whatever the path asks for, and listed
  back in the dialog so you can see what was held back.
- **Loopback binding.** The local server listens on `127.0.0.1` only; the
  tunnel is the sole way in.

The dialog keeps the URL, the viewer count and **Stop sharing** in front of you
the whole time, and the title-bar icon stays lit while a share is live — a
public link should never be running unnoticed. Stopping closes the tunnel and
the address stops answering immediately; quitting the app does the same.

The link is unguessable but it is public. Send it to people, not to a channel
that logs URLs.

### What it is not

This is a read-only view, not collaborative editing. Nobody on the other end
can type into your project, and there is no merge, no cursor sharing and no
second writer. That is a deliberate limit rather than an unfinished one: the
useful case is "look at this with me for five minutes", and it is served
without any of the machinery that shared editing would need.


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

**Run Configurations** — from the run picker or Find Action — is a GUI editor
over `.nova/run.json`, with a field for everything that goes into the final
command line:

- **Command and arguments**, kept separate so arguments can be edited without
  retyping the command.
- **Environment variables**, composed into a `VAR=value` prefix with quoting
  applied where it is needed.
- **Working directory**, composed as a subshell `cd` so the terminal's own
  directory is untouched afterwards.
- **Before-launch tasks** — commands joined with `&&`, so a failing build stops
  the run instead of launching against stale output.
- **Compound configurations** — tick other configurations to run them in
  parallel and wait for all of them, which is the dev-server-plus-worker shape
  compounds exist for.

The file stays hand-editable; this is the version of it with fields instead of
syntax.

The shell runs on a **real pseudo-terminal**, so it behaves like any other
terminal: `vim`, `top`, `less`, `git rebase -i` and password prompts all work,
`stdout` is a tty, the width follows the pane, and Ctrl+C interrupts the
foreground job rather than the shell. History, line editing and `cd` are the
shell's own.

`node-pty` ships N-API prebuilds, so there is no rebuild step. If the native
module is unavailable Nova falls back to running one child process per command
and says so on open — that path cannot run interactive programs.

---

## Themes and settings

Ten complete themes — Nova Dark, Tokyo Night, Dracula, Nord, One Dark Pro,
Monokai Pro, Gruvbox Dark, Midnight Ocean, GitHub Light and Solarized Light. Each
drives the whole application: chrome, editor, terminal, Mermaid diagrams and
Markdown preview all change together. Three file-icon packs (Nova, Classic,
Minimal) are switchable independently.

### Semantic highlighting

A grammar alone cannot colour a function name. Monaco's grammars classify
keywords, strings, numbers and comments, and report every remaining word —
function names, class names, parameters, locals — as one undifferentiated
`identifier` token. No theme can separate what the grammar never separated, so
every theme rendered a call the same colour as the variable beside it.

Nova adds a semantic layer on top, with two sources:

- **The language server**, asked for `textDocument/semanticTokens/full`. It has
  resolved the file, so it knows a name is a method and not a field. Servers
  are never waited on: a request that arrives before one has started uses the
  fallback and is upgraded when `lsp:status` reports the server ready, because
  a file that is grey for the ten seconds rust-analyzer takes to boot is worse
  than one coloured approximately.
- **A syntactic fallback**, for the languages with no server installed. It runs
  over Monaco's own tokenization and reclassifies only the spans the grammar
  gave up on — never a keyword or a string — marking the two shapes every
  language shares: a name being called, and a name being declared as a function
  or a type.

Both feed one legend, so each theme writes one rule per token type
(`function`, `class`, `parameter`, `enumMember` …) and it applies to every
language. Servers that extend the standard legend, as rust-analyzer and clangd
both do, are folded onto the closest type Nova paints.

Settings cover font size and family, tab size, word wrap, minimap, line numbers,
inlay hints, blame gutter, breadcrumbs, code vision, auto-save, the code style
scheme, format-on-save and optimize-imports-on-save, the inspection profile, the
keymap, saved search scopes, the AI provider, model and permission mode, the
browser home page, and the icon pack. They persist to disk and survive a reload;
nested groups are merged with the defaults on load, so a settings file written
by an older build never loses options added since.

---

## Keymap and macros

Every application-level shortcut is data rather than a hardcoded branch, and
**Settings › Keymap** rebinds them: click a binding, press the new combination,
Backspace to unbind, Escape to cancel. Combos are written `mod+shift+f`, where
`mod` is ⌘ on macOS and Ctrl elsewhere, so one binding works on both. Editor-
local bindings (multi-cursor, folding, case transforms) stay on Monaco's own
keymap and remain reachable by name from Find Action.

**Macros** record and replay a sequence of keystrokes in the editor: `⌥⌘R`
starts and stops recording, `⇧⌥⌘R` plays back. Recording captures raw key
events, so shortcuts pressed during a recording — `⌘D`, `⌥↓`, tabbing through a
snippet — do on replay exactly what they did live. Printable characters are
replayed through Monaco's own type command (its text comes from input events,
not keydowns), everything else as a key event, one per tick so each is fully
processed before the next arrives.

---

## Scratch files

Throwaway files that live outside the project, in `~/.nova/scratches`, and
survive it being closed. **Scratch Files…** in Find Action opens the manager:
pick a language, create, and it opens in the ordinary editor with full syntax
highlighting, completion and refactoring for that language — a scratch is a real
file, not a separate toy buffer. Useful for a query under test, a snippet being
shaped, or notes that should not end up in git.

---

## Project structure

**Project Structure** in Find Action shows the model Nova infers rather than one
you have to declare. A module is any directory with its own build manifest —
`package.json`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`,
`pyproject.toml`, `Gemfile`, `composer.json`, `Package.swift`, `pubspec.yaml` —
found up to three levels deep, so monorepos come out as the several modules they
are.

For each module it reads the manifest for its real name, language, declared
runtime (`node >=18`, `go 1.22`, `requires-python`), and the frameworks its
dependencies imply: Spring, JPA, Android, Django, FastAPI, React, Next.js,
NestJS, Flutter, Tokio, Gin and others. Workspace and path references between
manifests become inter-module dependency edges, resolved against the discovered
set so only real edges are shown. Clicking a module opens its manifest, which is
where changes belong.

The **SDKs** section probes the machine for node, python, go, rustc, java, ruby,
php, swift and dotnet, reporting each version and resolved binary, and naming
the ones that are missing.

---

## Plugins

Third-party extensions, installed straight from a git URL — no registry. See
[PLUGINS.md](PLUGINS.md) for the authoring guide.

- **Plugins** in the activity bar, then paste a repository URL. Nova clones it,
  validates its `nova-plugin.json`, runs its build step and loads it.
- Each plugin runs in **its own forked process**, with a permission set the user
  approves at install time. Nothing is granted implicitly.
- A plugin can contribute commands, views, status-bar items, and **MCP servers**
  — which hand the Claude and Codex CLIs new tools on the next prompt.
- Update is `git fetch` + rebuild; uninstall deletes the directory.

## Inspections

Checks a language server does not give you: things that compile and are still
wrong. `debugger` left in, `.only` silently disabling a test file, `==` where
`===` was meant, an empty catch, a mutable default argument, a hardcoded secret.

Findings land in **Problems** alongside LSP diagnostics, with quick fixes on the
lightbulb. Suppress one with `// nova-ignore <rule-id>` on the line or the line
above; a bare `// nova-ignore` suppresses everything on that line.

**Inspect Code** runs every enabled rule over the *whole project*, not just open
files, and groups the results by rule — because the question a batch run answers
is "how much of X do we have". It reads unsaved buffer content in preference to
the disk copy, and reports progress as it sweeps.

**Code Cleanup** applies every mechanical fix the run found, file by file,
through the same write path everything else uses so local history records each
one. Only replacement fixes are applied in bulk: a delete-line fix removes a
statement, and doing that unattended is how cleanups eat code.

**Inspection profiles** live in Settings › Inspections — one severity dropdown
per rule (error / warning / info / off), applied both to the live editor pass
and to Inspect Code.

**Spellchecker.** A `typo` inspection flags common misspellings in comments,
strings and identifiers, splitting camelCase so `seperateValue` is caught. It is
a curated list rather than a dictionary, so every word it flags is genuinely
wrong — no "unknown word" noise on domain vocabulary — and each finding carries
a one-click fix that preserves the original's capitalisation.

## Structural search and live templates

**Structural Search** in the activity bar matches code by shape rather than
text. `console.log($arg$)` captures balanced expressions, so a nested call comes
back whole where a regex would stop at the first `)`. The same hole twice must
bind identically, which is how `$x$ === $x$` finds self-comparisons. Replace
runs through the same preview a refactoring does.

Live templates expand from the completion list — `iter`, `fori`, `tryc`, `rfc`,
`usestate`, `iferr` and friends, with tab stops. Add your own in settings.

## Test coverage

**Coverage** in the bottom panel reads whatever report the project has: lcov,
Istanbul's `coverage-final.json`, JaCoCo/Cobertura XML, or Go's `coverage.out`.
Uncovered lines get a red gutter stripe, partially-covered branches an amber
one. The list sorts least-covered first, and clicking a row jumps to the first
gap.

## Profiler

**Profiler** in the bottom panel runs a Node script under `--cpu-prof`, or opens
any `.cpuprofile` exported from Chrome DevTools. Flame graph plus a hot-function
table. Recursive functions are counted once per stack rather than once per
frame, so totals stay within the profile's own duration.

## Build tools

**Build** in the bottom panel detects Gradle, Maven, npm/pnpm/yarn, Cargo and
Make. Tasks run in the terminal. Dependency trees are read from the build file
where possible and resolved with the real tool on request — Gradle's conflict
resolutions (`1.0 -> 2.0`) are shown as such.

## Request client

Open a `.http` or `.rest` file and press **Requests** in the tab strip. The base
format is the one IntelliJ and the VS Code REST Client share — `###`
separators, `@vars`, `{{substitutions}}`, and environments from
`http-client.env.json` (overlaid by `http-client.private.env.json`, so secrets
stay out of version control). A file written for either of those tools opens
here unchanged.

Everything past plain HTTP is an additive extension, chosen so a file that uses
none of it still parses identically elsewhere: extra verbs in the method slot,
`# @directive` lines that read as comments to any other tool, and block markers
inside the body.

Requests run in the main process, so they are not subject to the page's origin
policy — an editor that could only call CORS-permissive APIs would be useless
for the local backends these files point at.

### Protocols

| Verb | What it does |
|---|---|
| `GET` / `POST` / … | REST, with redirects followed by hand so cookies apply at every hop |
| `GRAPHQL` | Sends a query with its variables, and browses the server's schema |
| `WEBSOCKET` (or `WS`) | Opens a socket you can type into, with a message log |
| `SSE` | Reads an event stream, reassembling events split across packets |
| `GRPC` | Calls a service, unary or streaming, over a proto file or reflection |

```http
GRAPHQL {{base}}/graphql

query Users($limit: Int) { users(limit: $limit) { id name } }

--variables
{ "limit": 10 }

### A gRPC call — the method comes after the address
GRPC localhost:50051 billing.Orders/Compute
# @proto ./billing.proto

{ "items": 3 }
```

gRPC discovers what a server offers two ways, because in practice you have one
or the other: a `.proto` file, which is exact and works offline, or **server
reflection**, which needs nothing but the address. Reflection is tried first
when no proto is named. All four call shapes work — unary, server-streaming,
client-streaming and bidirectional — and messages cross as JSON using
protobuf's own mapping, so a `bytes` field is base64 and a 64-bit integer is a
string, the same text `grpcurl` would show.

### Auth

`# @auth` above a request, with the credential normally coming from an
environment variable rather than the file:

```http
# @auth bearer {{token}}
# @auth basic ada {{password}}
# @auth apikey header X-Api-Key {{key}}
# @auth oauth2 grant=client_credentials token_url={{idp}}/token client_id={{id}} client_secret={{secret}} scope=read
```

OAuth2 supports the two grants that complete without a browser, and caches the
token until it expires — a file with twenty requests against one API fetches
one token, not twenty. Authorization Code needs a redirect the editor cannot
own, so a token obtained elsewhere is pasted in as `bearer` instead.
Credentials are redacted wherever a request is displayed back, so a live token
never ends up on screen or in a screenshot of it.

### Cookies

A jar is kept per project — two checkouts pointing at the same staging host
never see each other's session. It is applied and harvested at every hop of a
redirect, which is where a login flow actually sets its session; without that,
`### log in` followed by `### read my profile` could never work. **Cookies** in
the toolbar shows what is stored and clears it.

### Bodies

```http
POST {{base}}/import

< ./payload.json
```

```http
POST {{base}}/files

--form
name: avatar
filename: ./avatar.png
type: image/png
--form
name: caption
value: My avatar
```

Uploads are read at send time rather than at parse time, so a large file never
sits in the parse tree. A body with no `Content-Type` gets one inferred from
its shape or the file's extension; an explicit header always wins.

### Other directives

`# @name` renames a request, `# @timeout 5000` overrides the default 60s,
`# @no-redirect` returns the 302 itself, `# @no-cookies` opts out of the jar,
`# @send` gives a WebSocket a message to deliver as soon as it opens, and
`# @proto` points gRPC at a schema. An unrecognised directive is treated as the
comment it looks like, so annotations meant for other tools are not rejected.

### Reading the result

The response pane shows the status, timing, size, headers, the redirect chain,
the cookies a response set, and the request **as actually sent** after auth and
interpolation. A GraphQL failure is called out separately: it arrives as a 200
with an `errors` array, and a client that only reads the status code reports
success on every failure.

Streaming protocols get a message log instead — each message with its direction
and timestamp — and a box to send into, for sockets and client-streaming gRPC.

**History** keeps the last 200 runs per project and can reopen any stored
response. The index and the bodies are stored apart, so opening the panel does
not load megabytes of payload nobody asked for.

### Assertions and chaining

A request file becomes a test suite through two script blocks, in IntelliJ's
syntax — `< {% %}` before the request, `> {% %}` after the response:

```http
### Log in
POST {{base}}/login

{ "user": "ada", "password": "{{password}}" }

> {%
  nova.test('returns a token', () => nova.expect(nova.response.status).toBe(200))
  nova.vars.set('token', nova.response.json().access_token)
%}

### Read the profile the token belongs to
GET {{base}}/me
Authorization: Bearer {{token}}

> {%
  nova.test('is the right user', () => nova.expect(nova.response.json().name).toBe('Ada'))
  nova.test('was quick', () => nova.expect(nova.response.time).toBeLessThan(500))
%}
```

`nova.vars.set` is what makes the second request possible: what one response
handler captures is a `{{variable}}` for every request after it. **Run all**
runs the file in order with that scope around it, and running one request keeps
the scope too.

Available in a response script: `nova.response` (`status`, `headers` in lower
case, `body`, `json()`, `time`, `size`), `nova.test(name, fn)`,
`nova.expect(...)` with `toBe`, `toEqual`, `toContain`, `toMatch`,
`toBeGreaterThan`, `toBeLessThan`, `toBeDefined`, `toBeTruthy`, `toHaveLength`,
`toHaveProperty` and `.not` on any of them, plus `nova.vars` and `nova.log`. A
pre-request script gets `nova.request`, which it can rewrite.

A failing assertion fails its own test and nothing else — the twelve checks
after the first failure are exactly the ones you want to see. Scripts run in a
`vm` context with no `require`, no `process` and no filesystem, and are stopped
after five seconds, so a `while (true)` in a handler cannot take the window
with it.

### Data-driven runs

```http
### One case per row
# @data ./cases.csv
POST {{base}}/users

{ "name": "{{name}}", "role": "{{role}}" }
```

Each row of a CSV or JSON file becomes a set of variables and one run of the
request, reported as its own step.

### OpenAPI

**Import** reads a JSON or YAML spec — OpenAPI 3 or Swagger 2 — and writes a
`.http` file from it: one request per operation, path parameters as
`{{variables}}`, request bodies sampled from their schemas, and a status
assertion on each. The result is an ordinary request file, not a linked
artifact; it is yours to edit from that point on.

`# @spec ./openapi.yaml` on a request goes the other way, checking the response
body against the schema the operation declares. This is the check a status code
cannot make: a perfectly good 200 that dropped a field, changed a type, or
started returning null where the schema says it never will.

The validator handles a documented subset of JSON Schema — types (including
OpenAPI's `nullable`), `required`, `properties`, `additionalProperties`,
`items`, `enum`, `const`, `format`, the numeric and length bounds, `pattern`,
`uniqueItems`, `allOf`/`anyOf`/`oneOf`/`not`, and local `$ref`. Anything it does
not check it **says** it did not check, rather than reporting a pass over a
schema it half-read.

### Mock server

**Mock** serves a spec's own example responses on a local port, so a client can
be written before the backend exists. Responses come from an `example`, then a
named entry under `examples`, then a value generated from the schema —
generating last, because a hand-written example says something a generated one
cannot. `?__status=404` asks for a particular response, which is the only way
to exercise an error path against a mock. It binds to loopback only.

### Running in CI

```bash
npm run api -- api/ --env staging
```

The same parser, executor, script runtime and cookie jar as the panel — a suite
that passes in the editor passes here, and the reverse. Point it at a file or a
directory, and it exits non-zero if anything failed. `--bail` stops at the first
failure, `--reporter json` prints machine-readable results, and a request with
no assertions is reported as such rather than counted as a pass.

## Database console

**Database Console** from the command palette. Drives `psql`, `mysql` or
`sqlite3` — the client already on your machine, honouring the auth you have
already configured. Connection manager, schema browser with primary keys and
nullability, and a query console with a results grid. Passwords go to the OS
keychain via `safeStorage`, or are simply not stored if it is unavailable.

**Schema-aware SQL completion.** The editor suggests tables after
`FROM`/`JOIN`/`UPDATE`/`INTO` and columns everywhere else, preferring the
columns of the tables already named in the statement. `orders.` lists only that
table's columns. It runs off the introspection the sidebar already loaded, so
being schema-aware costs no extra round-trips. Tab accepts, ⌃Space re-opens.

**Editable result grid.** When the query is a single-table `SELECT` whose
primary key is in the result — the only case an `UPDATE` can be generated for
without guessing — cells become editable on double-click. Edits are staged, not
written: the pending count, the exact generated SQL (copyable) and Apply/Discard
sit above the grid, and each statement addresses its row by the primary key's
*original* values. Anything else says plainly that it is read-only and why.

**DDL generation** writes `CREATE TABLE` statements for the live schema into a
scratch file. **Schema diff** introspects another connection and produces a
Markdown report of tables added or removed and columns added, dropped or
retyped, with best-effort `ALTER TABLE` migration SQL in the dialect of the
connection you started from.

## Docker, Kubernetes and SSH

**Infra** in the bottom panel. Containers and images with start/stop/remove,
Kubernetes contexts, namespaces and resources, and hosts from `~/.ssh/config`.
Anything interactive — a container shell, a log follow, an SSH session — opens
in the terminal, where it can be interrupted.
