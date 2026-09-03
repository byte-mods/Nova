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

## 1.2.3

### Keep going

An agent turn ends when the agent has said enough, not when the work is done.
The gap between those two is where most of the friction in using an assistant
lives: you read "I've implemented the first part", type "continue", read it
again, type "continue" again — and you are really just being the loop by hand.

**Keep going**, next to *Plan first* in the composer, is the loop. Nova drives
the next turn itself and keeps driving until the task is actually finished.

Three things decide when that is:

- **The agent declares, Nova verifies.** Each turn ends with a marker: still
  working, finished, or blocked. "Finished" does not end the run — it promotes
  it to the project's test suite, and a red suite sends the agent back to work
  with the failing test names attached. It cannot talk its way past a broken
  build.
- **Then the checks a suite cannot make.** Once the suite is green, the agent
  writes a manual test plan for what it changed, carries out every item it can
  itself, and records what it actually observed. Only the items that genuinely
  need a person — a visual check, a real device, a third-party account — are
  left, and it has to say so for each.
- **Blocked means blocked.** Stopping to ask is the thing this mode exists to
  avoid, so it is reserved for what a person must actually supply: a missing
  credential, a destructive choice, a real ambiguity in the goal. A failing
  test, a missing file, a compile error, a design decision with a defensible
  answer — the agent is told plainly that none of those are blockers.

The failure mode of a loop like this is not a wrong answer, it is a confident
one repeated forever at your expense. So something has to be moving: three
consecutive turns that change no file end the run and say so. That guard is why
the turn limit defaults to **no limit** — a run stops when it stops making
progress rather than at an arbitrary number. Set a ceiling in Settings › AI
console if you would rather have one, and Stop ends any run immediately.

Planning is disabled while this is on. Both features exist to stop the agent
halting halfway, and running them together would produce a plan that the loop
then approves on your behalf — an approval gate that approves itself is worse
than not having one. The test gate is the check here.

### Fable is a deep model, not a fast one

Claude Fable was listed under the **Fast** tier — the one Nova describes as
"answers soonest, cheapest". It is neither: thinking is always on and cannot be
turned off, and it costs about twice what Opus does. Anyone who picked Fast to
save time and money got the slowest and most expensive model in the list. It is
under **Deep** now, where it belongs.

The model-id placeholder in Settings also still suggested `gpt-5-codex`, which
is no longer one of the listed Codex models.

---

## 1.2.2

### An audit, and the twenty-nine things it found

A correctness and security review of the whole tree found 29 defects and 26
gaps, almost all of them in the parts of the codebase that had no tests: the
share server, the plugin installer, the HTTP client, the symbol indexer, and
every store that reads a file, changes it, and writes it back.

The pattern behind most of them was the same. A module's doc comment stated a
guarantee, and the code one screen below did not implement it. Three files
claimed path containment they did not provide; one said a share must never
outlive the window and then discarded the promise that would have stopped it;
one said snapshots "collapse into the previous one" and then dropped them.

#### Code from a repository could reach the machine

- **A `.http` file's script block escaped the `vm` sandbox.** The context was
  built by handing the script this realm's `Object`, `Array`, `JSON` and
  friends — and `Object.constructor` is the host `Function`, so calling it
  compiled code in the main process, next to `safeStorage` and the decrypted
  API keys. Nothing from the host realm crosses the boundary now: the whole
  `nova` API is compiled inside the context, data goes in as a JSON literal and
  comes back as a JSON string, and the context is built from a null-prototype
  object so `globalThis.constructor` has nothing to find either. 28 escape
  vectors are tested, including the six that used to work.
- **A `.http` file could read any file on the machine** and post it to a server
  it named, through `@data`, `< ./body`, or a multipart upload. Paths from a
  repository now resolve through one shared check.
- **The share server's containment check ignored symlinks** — the one case its
  own comment promised to handle. `ln -s / link` inside a shared project served
  the machine. The plugin host had the identical hole, and `.proto` imports and
  coverage reports were two more ways to name a path outside the project.
  All five go through `resolveInRoot`, which resolves the root *and* the target
  with `realpath` before comparing them.
- **`Authorization` was replayed to whatever host a redirect named.** Nova
  follows redirects itself, so the browser rule that would have applied had to
  be applied here: credentials are dropped when a hop crosses origin, and the
  hop records that it happened. Headers an API-key scheme set are dropped too,
  whatever the user called them.
- **A plugin's build command ran before the user approved anything.** Installing
  a plugin is running its code, and that is where it starts. The install now
  stops before the build, shows the command verbatim, and asks — before the
  clone is promoted, so refusing leaves nothing installed.

#### Losing the user's work

- **One unreadable keychain entry wiped every stored API key**, and every stored
  database password. "No file yet" and "the file will not decrypt" were both
  answered with `{}`, and the write that followed made that `{}` permanent. They
  are different events now, and the second one stops the write.
- **A single unparseable byte deleted a whole file on the next save** — chats,
  run configurations, the plugin registry, recents, settings. A damaged file is
  moved aside as `<name>.corrupt` rather than read as empty.
- **Concurrent saves lost each other and reported success.** Seven stores read,
  modified and wrote with no lock between them. Every store now serialises
  read-modify-write per file; 25 concurrent writers all survive in the tests.
- **Every whole-file write is atomic** — a temporary file and a rename, so a
  crash halfway through leaves the old contents rather than a truncated file
  that the next read cannot parse.
- **Opening a file over 8 MB and typing one character truncated it** to a
  placeholder comment. The placeholder was editable text, and saving it wrote
  that one line over the file. Files that were not loaded, and files that are
  not text, now open as a panel that says so and cannot be saved.
- **Non-image binaries opened as editable base64** and skipped the size limit
  entirely, so a 2 GB archive was read whole and encoded on the way to an editor
  that could not show it.
- **The recovery net had two holes**, and they lined up with the losses above: a
  snapshot was skipped for large files — exactly the case worth keeping — and
  "coalescing" dropped the newer snapshot instead of replacing the older one.
- **`git checkout <branch>` ran without `--`**, so a stale branch name was
  resolved as a pathspec and discarded that file's uncommitted changes.

#### Freezing, exhausting, or hanging

- **A language server could exhaust the app's memory** by announcing a message
  it never sent, and framing was quadratic besides — a 64 MB reply spent seconds
  copying itself. Both clients share one bounded framer now; the same reply
  assembles in 45 ms.
- **A visual-regression baseline could be a decompression bomb.** A 74-byte PNG
  claiming 65535 × 65535 got as far as a 17 GB allocation. Dimensions are
  checked before anything is allocated, `inflate` is given a ceiling, and the
  inflated size has to match what the header implied.
- **Quitting during a share left the tunnel running** and the project readable
  from the internet. `before-quit` fired the teardown into a process that was
  already exiting. Quitting is now two-step: cancel, await every teardown, exit.
- **Opening a project with a minified file** ran the declaration patterns over a
  line hundreds of kilobytes long. Those patterns are ambiguous enough that this
  is not somewhere to be relaxed, so lines over 2 KB are no longer scanned — no
  language writes a declaration on one.
- **A failed WebSocket connect could settle only via `close`**, which is not
  guaranteed to arrive; it settles on `error` too.
- **A server using string request ids** — which the JSON-RPC spec allows — made
  every request hang until its timeout, because the pending map was keyed by
  number.
- **The coverage poll could run for the life of the session** when a run neither
  finished nor was replaced.
- **Closing a tab never freed the file.** Buffers were only ever added to, so a
  session that browsed a few hundred files held all of them, base64 included.

#### Wrong, quietly

- **A malformed lockfile made the vulnerability scanner report "clean".** The
  parse failure was indistinguishable from having no dependencies, which is the
  worst answer a scanner can give. Unreadable lockfiles are now named in the
  report.
- **API keys in a custom header were written to disk unredacted.** Redaction
  went by a fixed list of header names, and an API-key scheme puts its secret in
  a header the *user* named. Redaction now follows provenance — the code that
  set the header says it is a credential — with the name list as a fallback. Key
  in a query string is redacted too.
- **Nova could not open or search two of its own source files**, which had literal
  NUL bytes written into them where the escape was meant.
- **Nova's own saves came back as somebody else's edits**, putting a "changed on
  disk" bar over the file the user had just saved.
- **Reloading a changed file never told the language server**, so every
  diagnostic after a branch switch was computed against content the file no
  longer had.
- **On Windows, nothing that runs an external tool could find one.** `which()`
  never tried `PATHEXT`, so `node` never matched `node.exe`, and the fallback
  shelled out to `/bin/sh`. There were two copies of it; now there is one, it
  has a Windows path, and it no longer interpolates a name into a shell string.
- **The tunnel URL was matched against a single stdout chunk** rather than the
  accumulated output, so a chunk boundary inside cloudflared's banner meant a
  working tunnel was reported as a failure.
- **Any page in the browser pane could inject actions into an E2E recording.**
  The channel is per-injection now, and nothing is accepted unless a recording
  is actually in progress.
- **The main window had no `will-navigate` guard**, so a navigation could load a
  remote page into the renderer that owns the IPC bridge.
- **The share server had no viewer cap**, and answered `HEAD` by opening a
  stream that nothing would close.

### Tests

The security-critical modules were exactly the untested ones. Six of them are
now bundled for the suite, and a new `test-hardening` suite adds **56 checks**
over the boundaries: path containment including symlink escape, stores under 25
concurrent writers, the script sandbox against every escape that used to work,
credential stripping across a redirect, redaction by provenance, bounded and
linear RPC framing, and a PNG decoder that refuses a bomb.

`npm run test:offline` is **872 checks**, up from 816. The README's counts had
drifted and are corrected.

### Not fixed

- The `.http` sandbox is a **realm** boundary, not a process one. It closes
  every escape found, but a separate process — the one the plugin host already
  runs in — remains the stronger answer.
- The catastrophic backtracking reported in the symbol indexer **could not be
  reproduced**; the 2 KB line cap is a guard rather than a confirmed fix.
- The renderer CSP still allows `unsafe-inline` and `unsafe-eval`; there is
  still no workspace-trust model; IPC argument validation was added where it
  destroyed state, not across all 249 channels; and the accessibility and
  Unicode-detection gaps are untouched.

---

## 1.2.1

### Current models, and a list that cannot go stale again

- **Model ids updated** against each vendor's own documentation, August 2026:
  `kimi-k3`; `gpt-5.6-sol` / `terra` / `luna` alongside `gpt-5.3-codex`;
  `gemini-3.7-flash` and the 3.x line; `glm-5.3`; `deepseek-v4-pro` and
  `v4-flash`. Claude keeps its aliases — `opus`, `sonnet`, `haiku`, `fable` —
  which resolve to the current model of that name and therefore never expire.
- **The model field is a combobox, not a dropdown.** Any list shipped with an
  editor is stale the week after it is written, and being unable to select a
  model because Nova has not heard of it is a wall. Suggestions are offered;
  anything can be typed.
- **Models you use are remembered** per provider and offered first from then on
  — the only part of the list that cannot be out of date.
- **Claude gains its effort dial**: `low`, `medium`, `high`, `xhigh`, `max`,
  taken from `claude --help` rather than assumed. It was omitted in 1.2.0 on the
  incorrect belief that the CLI had no such flag.
- Switching provider clears the model, since asking Gemini for `opus` fails at
  the CLI.

### Test flakiness

Three checks that reported the machine rather than the product:

- The browser address bar typed a URL and slept for three seconds. The pane's
  webview can take focus back after the click, so the typing sometimes went
  nowhere, and a slow load failed a check that a fast one passed. It now
  confirms the field took the text and waits for the navigation.
- The breakpoint-gutter check counted glyphs after a fixed sleep, which is not
  long enough by the time the suite has been through eighteen other sections.
- The terminal section's working directory, fixed in 1.0.2, gained the same
  treatment for the shell it inherits.

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
