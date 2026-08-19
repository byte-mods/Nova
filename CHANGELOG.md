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
