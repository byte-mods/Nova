# Feature checklist

Every user-facing capability in Nova IDE, grouped by area. Each row is exercised
by `tests/verify-ui.mjs`, which drives the running app through **real UI
interaction** (clicking elements, typing, keyboard shortcuts) and asserts on the
rendered DOM — not by calling store or IPC methods directly.

**Status: 117/117 checks passing** (`npm run test:ui`, run against the live app).
Every row below has its own assertion in the suite.

Run it with the app started as:

```bash
NOVA_DEBUG_PORT=9223 npm run dev
```

```bash
node tests/verify-ui.mjs
```

## 1. Shell & layout
- [x] 1.1 Title bar shows the open project name
- [x] 1.2 Breadcrumb reflects the active file
- [x] 1.3 Activity bar switches sidebar views (5 views)
- [x] 1.4 Sidebar toggles from the title bar
- [x] 1.5 Bottom panel toggles from the title bar
- [x] 1.6 AI console toggles from the title bar
- [x] 1.7 Splitters resize sidebar / panel / AI console
- [x] 1.8 Status bar shows branch, symbol count, language, cursor position

## 2. File explorer
- [x] 2.1 Tree lists project files with per-type icons
- [x] 2.2 Folder expands and collapses on click
- [x] 2.3 Single click opens a file in a preview tab
- [x] 2.4 Context menu offers New File / Folder / Diagram / Rename / History / Copy path / Trash
- [x] 2.5 New file is created from the header button
- [x] 2.6 Git status decorations appear on changed files

## 3. Editor
- [x] 3.1 File opens with syntax highlighting
- [x] 3.2 Typing marks the tab dirty
- [x] 3.3 Save clears the dirty marker and writes to disk
- [x] 3.4 Tabs switch on click and close on the X
- [x] 3.5 Cursor position updates the status bar
- [x] 3.6 Multiple languages highlight correctly

## 4. Navigation
- [x] 4.1 Go to file palette (⌘P) opens and filters
- [x] 4.2 Command palette (⇧⌘P) opens, filters and runs a command
- [x] 4.3 Go to Symbol palette (⇧⌘O) lists project symbols with kind badges
- [x] 4.4 Choosing a symbol opens its file at the right line
- [x] 4.5 Find Usages (context menu) fills the Usages panel
- [x] 4.6 Clicking a usage traverses to that file and line
- [x] 4.7 Usages panel groups by file with counts
- [x] 4.8 Project-wide search (⇧⌘F) returns hits and opens them

## 5. Autocomplete
- [x] 5.1 Suggest popup appears while typing
- [x] 5.2 Popup contains project symbols (class from another file)
- [x] 5.3 Suggestion detail shows kind and container
- [x] 5.4 Accepting a suggestion inserts the identifier

## 6. Diagrams
- [x] 6.1 Diagrams sidebar lists templates
- [x] 6.2 Creating from a template opens the canvas editor
- [x] 6.3 Nodes render with icons, labels and shapes
- [x] 6.4 Clicking a node selects it and shows the inspector
- [x] 6.5 Editing the label updates the canvas
- [x] 6.6 Changing shape / colour / icon updates the node
- [x] 6.7 Adding a node via the toolbar works
- [x] 6.8 Mermaid mode renders a live diagram
- [x] 6.9 Diagram saves to disk

## 7. Markdown
- [x] 7.1 Markdown opens in split view
- [x] 7.2 Preview renders headings, tables and code
- [x] 7.3 Mermaid fences render as diagrams
- [x] 7.4 Source / Split / Preview modes switch

## 8. Browser pane
- [x] 8.1 Opens from the title bar
- [x] 8.2 Loads a URL typed into the address bar
- [x] 8.3 Renders the page (real DOM in the guest)
- [x] 8.4 Back / forward / reload work
- [x] 8.5 Responsive presets resize the frame

## 9. Git
- [x] 9.1 Source control shows branch and change counts
- [x] 9.2 Changed files listed with status letters
- [x] 9.3 Clicking a change opens a diff
- [x] 9.4 Stage / unstage a file
- [x] 9.5 Commit creates a commit and clears the list
- [x] 9.6 Commit history lists commits
- [x] 9.7 Clicking a commit opens the commit viewer with its diff
- [x] 9.8 Commit context menu offers revert / cherry-pick / reset
- [x] 9.9 Blame gutter shows per-line authorship
- [x] 9.10 Stash creates and lists a stash

## 10. Debugger
- [x] 10.1 Gutter click sets a breakpoint (red dot)
- [x] 10.2 Debug panel starts a session
- [x] 10.3 Execution pauses, paused line highlighted
- [x] 10.4 Call stack lists frames, clicking one navigates
- [x] 10.5 Variables tree expands scopes
- [x] 10.6 Watch expression evaluates
- [x] 10.7 Step over / into / out buttons work
- [x] 10.8 Continue runs to completion, console shows output

## 11. Tests
- [x] 11.1 Test framework detected for the project
- [x] 11.2 Run all executes and reports results
- [x] 11.3 Results grouped with pass/fail counts
- [x] 11.4 Failure output expands
- [x] 11.5 Gutter ▶ runs a single test

## 12. Language server features
- [x] 12.1 Diagnostics render as squiggles and in Problems
- [x] 12.2 Hover shows type information
- [x] 12.3 Completion from the server
- [x] 12.4 Rename shows the preview dialog, Apply rewrites files
- [x] 12.5 Call hierarchy panel populates and expands
- [x] 12.6 Inlay hints render inline

## 13. AI console
- [x] 13.1 Provider dropdown lists Claude and Codex
- [x] 13.2 Suggestion chips fill the composer
- [x] 13.3 Sending a prompt streams a reply
- [x] 13.4 Tool calls render and expand
- [x] 13.5 File changes appear as change cards with +/− counts
- [x] 13.6 Review opens the diff in the editor
- [x] 13.7 Revert restores the file
- [x] 13.8 Permission mode selector changes the CLI flags

## 14. Terminal & run
- [x] 14.1 Terminal opens and shows a prompt
- [x] 14.2 A command runs and prints output
- [x] 14.3 `cd` persists between commands
- [x] 14.4 Run picker lists detected configurations
- [x] 14.5 Running a configuration executes it in the terminal

## 15. Themes & settings
- [x] 15.1 Themes sidebar lists 10 themes with previews
- [x] 15.2 Selecting a theme restyles the whole app
- [x] 15.3 Settings page opens
- [x] 15.4 Editor settings (font size, word wrap, minimap) apply
- [x] 15.5 Icon pack switch changes tree icons
- [x] 15.6 Language servers and debuggers listed with status
- [x] 15.7 Settings persist across reload

## 16. Local history
- [x] 16.1 Local History opens from the context menu
- [x] 16.2 Revisions listed after edits
- [x] 16.3 Diff against current shown
- [x] 16.4 Restore rewrites the file

## 17. Refactoring
- [x] 17.1 Refactor This (⌃T) lists every refactoring that applies here
- [x] 17.2 Entries needing a selection are disabled, with the reason shown
- [x] 17.3 Extract Variable replaces the statement rather than stranding it
- [x] 17.4 Extract Method moves the body out and calls it, with `self`
- [x] 17.5 Extract Constant hoists to file scope below the imports
- [x] 17.6 Change Signature hides `self` and rewrites call sites across files
- [x] 17.7 Safe Delete refuses while references remain and lists them
- [x] 17.8 Move File renames on disk and recomputes relative imports

The engine itself is pure logic and is covered separately by
`npm run test:offline` (`tests/test-refactor.mjs`, 76 checks): every
refactoring, across TypeScript, JavaScript, Python, Java and Go, plus the
lexical core and the guard rails that make it refuse rather than guess.

## 18. Explain (AI walkthrough)
- [x] 18.1 Explain button is offered above an open source file
- [x] 18.2 It is disabled where there is nothing to explain
- [x] 18.3 Clicking it opens a walkthrough tab and starts a read-only run
- [x] 18.4 The document streams to completion
- [x] 18.5 Sections, tables and live Mermaid diagrams render
- [x] 18.6 Save as Markdown writes the document into the project
- [x] 18.7 The run edits nothing and leaves the AI conversation alone

The prompt contract and the preamble cleanup are covered offline by
`tests/test-explain.mjs` (17 checks).
