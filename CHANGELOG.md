# Changelog

Versions follow [semantic versioning](https://semver.org). The version in
`package.json` is the source of truth, and each release is an annotated git tag
of the form `vX.Y.Z` on the commit that ships it.

**Every push to `main` bumps the patch version.** So the next one after `1.0.0`
is `1.0.1`, then `1.0.2`, and so on. A minor bump (`1.1.0`) is for a feature
that changes what Nova can do; a major bump (`2.0.0`) is for a change that
breaks something someone was relying on — the plugin API, the `.http` format, or
the shape of a stored project file.

The steps for a release are in [docs/RELEASING.md](docs/RELEASING.md).

---

## 1.2.0

### The console could wedge, and did

A run whose completion never reached the message it belonged to left the console
marked busy for the rest of the session. Every prompt after that was **silently
discarded** by the guard in `send` — no error, no spinner, nothing to click. From
the outside the assistant had simply stopped answering mid-task.

Three separate causes, all fixed:

- The event handler returned early when it could not find the message a run
  belonged to, which threw the `done` away along with everything else. Switching
  chats mid-turn was enough to trigger it. Completion now releases the console
  before anything can decide not to handle the event.
- The run being waited on was held in a component ref, which is lost whenever
  the console is toggled with `⌘I`. It lives in the store now, which survives
  remounts.
- A `spawn` that failed outright emitted an error and never a completion, so the
  renderer waited for something that was never coming. Every run now ends
  exactly once, however it ends.
- **Stop** always releases the console, whether or not the process is still
  there. Cancelling is best-effort; being unable to type is not acceptable
  either way.

### Conversations are kept as they happen

History was written only when a turn completed — so a wedged or crashed run took
the whole conversation with it, and the history list stayed empty however long
you had been working. Messages are now saved as they arrive, debounced.

### Watch the code change

Files the assistant edits **open in the editor as it works**, so the change can
be watched rather than read about afterwards. Deliberately in the background:
stealing focus mid-turn would move the editor out from under someone reading,
and a five-file edit would drag them through five files in as many seconds.
Deleted files are skipped. Turn it off with `aiFollowEdits`.

### Models and effort

- Each assistant now offers **its own models**, labelled by the trade being made
  — Fast, Balanced, Deep. OpenCode lists whatever Ollama has pulled locally.
- Codex gains a **reasoning-effort** control, which it accepts as a config
  override. Only the CLIs that genuinely take one show it: a dial that silently
  does nothing would be worse than no dial.
- Switching provider clears the model, since asking Gemini for `opus` fails at
  the CLI.
- Model and effort sit in a row under the header. Putting three dropdowns in the
  header pushed the icon buttons off the edge of a narrow panel — the same
  present-but-unreachable failure as an overflowing tab strip.

---

## 1.1.2

- The README's opening paragraph still said the assistants were reached
  "through" the Claude CLI, which stopped being true in 1.1.0. Corrected, and
  the mobile-device mirror added to the same sentence — it had been missing
  since 1.0.1.

---

## 1.1.1

### File icons for everything

- The tree now recognises **around 190 extensions and 70 filenames**, up from
  roughly fifty. Python, Rust, Go, Ruby, Java, Swift, Vue, Svelte, Elixir,
  Haskell, Solidity, Terraform, notebooks, archives, fonts, media and the rest
  each get their own glyph and their language's own colour, so a tree is
  scannable by hue before a single name is read.
- **Credentials stand out.** `.env`, `.env.production`, `.pem`, `.keystore` and
  friends get a padlock or a key rather than a generic file, because noticing
  one in a tree is the point.
- **Precedence is explicit**: a whole filename beats a compound suffix beats an
  extension. `Cargo.toml` is not just any TOML, `client.d.ts` is a declaration
  rather than source, and a lockfile is visually distinct from the manifest it
  belongs to — one is hand-edited and the other never is.
- **An unknown extension still gets a plain file icon.** Guessing from three
  letters Nova has never seen would be confidently wrong rather than quietly
  neutral.

Glyphs are shared where nothing better is known. There is no Lucide icon for
Nim, and picking an arbitrary one would say something untrue about the language;
a generic code glyph in Nim's yellow says exactly as much as is actually known.

### Testing

- `test-icons.mjs` (39) covers the precedence rules, the `.env` variants, the
  three icon packs, and asserts that fifty-eight common file types all resolve
  to something specific while an unknown extension does not.
- Verified in a real tree as well as in the resolver: thirty-four files of
  different types rendered, each with the expected glyph and colour.

---

## 1.1.0

### Every assistant runs its vendor's own CLI

- **Gemini** joins as a provider, on the `gemini` CLI.
- **Kimi** now runs the `kimi` CLI rather than borrowing Claude's.
- **GLM** and **DeepSeek** run through `opencode`, which is a real client for
  them rather than an endpoint impersonating someone else's API.
- Claude, Codex and OpenCode are unchanged.

The previous arrangement pointed several providers at the Claude CLI with
`ANTHROPIC_BASE_URL` redirected. It worked, and it was the wrong shape: it
inherited that CLI's auth precedence — which is how a personal Anthropic token
nearly went to a third party — and a model was only ever as good as its ability
to impersonate another vendor's protocol. Each CLI now reads its credential from
its own environment variable and nothing is redirected.

Gemini and Kimi emit the same JSONL, so they share one reader. It is deliberately
tolerant: these CLIs rename fields between minor versions, and the failure that
matters is not a lost tool annotation but an empty reply because one key moved.
Text is looked for in every shape it is plausibly written in, and unknown event
types are ignored rather than thrown on.

### Testing

- `test-providers.mjs` (29) exercises the reader against the event kinds taken
  from the shipped Gemini CLI — `system`, `assistant`, `user`, `tool_call`,
  `tool_result`, `result`, `error` — including three different spellings of a
  failed tool result and the final line that repeats the whole answer.
- The live suite checks every provider maps to the binary its vendor ships, that
  nothing but Claude points at the Claude CLI, and that a missing CLI fails with
  its install command rather than a crash.

Neither the Gemini nor the Kimi CLI is installed on the machine this was written
on, so the reader is verified against those shapes rather than against a live
run. That is a weaker claim and is stated as one.

---

## 1.0.2

### Panels you can actually find

- **Every panel is now in the command palette** (`⇧⌘P` → "Coverage", "Security",
  "Devices"…). The tab strip scrolls with its scrollbar deliberately hidden, so
  when the window was narrow the panels past the edge had no route at all and no
  sign they existed. Typing a name does not care how wide the window is.
- The strip now **fades at whichever edge still has tabs behind it**, so there
  is something on screen saying "keep going".
- Activating a tab that is scrolled out of sight **brings it into view**, rather
  than leaving the panel looking like it ignored the click.

### The packaged app could start with no window

- `show: false` until `ready-to-show` avoids a flash of unpainted chrome, but it
  made the reveal depend on a single event. In a packaged build that event did
  not arrive: the app started, the renderer loaded and rendered the welcome
  screen, and the window was simply never shown — indistinguishable from a crash
  from the outside, and considerably harder to diagnose. The window is now
  revealed by whichever of `ready-to-show`, `did-finish-load` or a short timer
  comes first. A brief flash is cosmetic; an invisible editor is not usable.

### Testing

- The terminal section of the UI suite anchored itself to whatever directory the
  previous suite's shell happened to be sitting in — a terminal outlives the
  project that opened it, deliberately, so `cd src` landed somewhere unexpected
  and a working feature was reported as broken. It now starts from a known
  directory; what is under test is that `cd` persists, not where the shell began.
- New checks that every panel is reachable by name and that an overflowing strip
  says so.

---

## 1.0.1

### Android and iOS devices

- A **Devices** panel listing every Android emulator, iOS simulator and attached
  physical Android device, with start and stop.
- The running device is **mirrored into a pane**: click to tap, drag to swipe,
  type to send text. A drag of a few pixels is treated as a tap that moved, so
  buttons stay pressable.
- Install an `.apk` or `.app` onto the selected device, and stream `logcat`
  under the screen.
- The Android SDK is found without being on `PATH` — a complete Android Studio
  install very often leaves `adb` unreachable from a shell, and reporting
  "Android is not installed" to someone looking at Android Studio would be
  useless.
- What a platform cannot do is declared rather than hidden: `simctl` sends no
  taps and exposes no device log, so those controls are visibly unavailable with
  the reason attached, instead of silently doing nothing.

### Fixes

- **The welcome screen was cut off at the top** with the scrollbar already at the
  top. A flex container that centres a child taller than itself puts that child
  above the scroll origin, and there is no negative scroll to reach it. The
  image viewer had the same defect, where it made the top of a zoomed image
  unreachable. Both now centre with an auto margin, which stops when there is no
  room instead of pushing content out of reach.
- A mirrored frame could arrive **after** the mirror was stopped, painting a
  stale screen onto a pane the user had moved away from — a capture already in
  flight cannot be cancelled, so the result is now discarded unless the mirror
  that asked for it is still the current one.

### Testing

- `verify-devices.mjs` (21) boots a real emulator and checks mirroring, input
  and logs against it. Absent tooling is reported and skipped rather than passed,
  and physical devices are listed but never driven — pressing Home on someone's
  actual phone because it happened to be plugged in is an accident, not a test.
- The tooltip suite gained a check that no scroll container centres a child it
  could clip, so the welcome-screen class of bug fails a test rather than
  waiting to be noticed at an unusual window size.
- 476 live checks and 748 offline ones pass.

---

## 1.0.0

The first version worth calling one. Everything below is verified by **452 live
checks** driving the running application and **748 offline** ones — see
[tests/FEATURES.md](tests/FEATURES.md).

### The editor

- Project-wide symbol index built on open, with no language server required —
  driving go-to-definition, find usages, go-to-symbol, autocomplete, rename,
  code vision and breadcrumbs across 35 languages.
- **Twenty-three refactorings** on IntelliJ's keymap, each ending in a preview
  of every affected file before a byte is written.
- Debugger over DAP, a test runner across nine frameworks, coverage, Git with a
  three-way merge editor, a Chromium pane, and a diagram designer.
- Local history: every overwrite snapshotted independently of Git.

### The API client

- `.http` files as the collection, so it diffs and merges like the code it
  tests. HTTP, GraphQL, gRPC and WebSocket in one format.
- Assertions, chained values between requests, environments, data-driven runs,
  OpenAPI import, a mock server and a full response history.

### Testing tools

- An end-to-end recorder that writes Playwright specs, choosing locators the way
  a person would rather than emitting brittle CSS paths.
- Visual regression: baselines stored in the project, so they are reviewed in
  the same commit as the change that altered them.
- Security scanning — secrets, a CWE-tagged SAST pass, and a dependency audit
  across nine lockfile ecosystems, each finding rated by confidence.

### The AI console

- Six assistants: **Claude**, **Codex**, **OpenCode** (local, via Ollama), and
  **Kimi**, **GLM** and **DeepSeek** through their Anthropic-compatible
  endpoints. Keys are held in the OS keychain and never returned to the
  renderer.
- Requests that will change files are **planned first**, read-only, and nothing
  is written until the plan is approved.
- **Plan history** — every plan kept, retries filed as revisions and shown as a
  diff of the checklist.
- **Verified runs** — a finished plan triggers the project's own test suite and
  carries the result. A project with no framework is reported as having no
  tests, never as a pass.
- Every touched file becomes a change card with `+`/`−` counts, a diff and a
  revert button.

### Sharing

- A Cloudflare tunnel turns the session into a link: the project as a live
  read-only view that follows the editor, or a single request collection with
  credentials masked.
- **Live screen, camera and microphone**, in any combination, watched in a
  browser with nothing to install.
- Viewers can also follow **what the agent is doing** — the plan, the current
  step, files touched with line counts, and the test verdict.
- Read-only by construction: no endpoint on the share server writes anything,
  secrets are withheld and listed back, every path is resolved against the
  project root, and the token in the URL is the whole credential.

### Plugins

- A plugin is a git repository with a manifest. Its code runs in its own host
  process, so one that throws or spins cannot take the editor down.
- Permissions are explicit and shown before installing; an ungranted call fails
  at the call site naming the permission it needed.
- Plugins can contribute commands, views, status-bar items and MCP servers.

### Notable fixes made while getting here

- A vendor run carried the user's **personal Anthropic OAuth token** to the
  vendor's servers. `ANTHROPIC_AUTH_TOKEN` does not override a logged-in
  session — the CLI prefers its stored credentials — so each vendor now gets its
  own CLI config directory. A test asserts against a stub endpoint which
  credential actually goes on the wire.
- Broadcast media arrived out of order, because `Blob.arrayBuffer()` is
  asynchronous and the first chunk carries the header the stream is decoded
  against. The server now identifies that header by its EBML magic rather than
  trusting arrival order.
- Held-open HTTP responses are buffered to completion by some proxies, which
  silently broke both the media stream and the pre-existing presence channel.
  Media is served as segments that end, and the viewer polls as well as
  listening.
