# Releasing

Nova is versioned with [semantic versioning](https://semver.org). `package.json`
holds the version, and every release is an **annotated tag** `vX.Y.Z` on the
commit that ships it — annotated rather than lightweight so the tag itself
records who cut it and when.

## The rule

**Every push to `main` bumps the patch version.** `1.0.0` → `1.0.1` → `1.0.2`.

Go further than a patch when the change is bigger than a fix:

| Bump | When | Example |
|---|---|---|
| **patch** `1.0.1` | anything that does not change the contract | a fix, a test, a doc, an internal refactor |
| **minor** `1.1.0` | Nova can do something it could not before | a new panel, another AI provider, a new refactoring |
| **major** `2.0.0` | something someone relied on stops working | the plugin API, the `.http` format, the shape of a stored project file |

The three things treated as public contracts, and therefore the three things a
major bump exists to protect:

- **`shared/plugin.ts`** — the manifest schema and the API handed to
  `activate()`. Third-party code compiles against this.
- **The `.http` format** — request files live in users' repositories and are
  committed. Reading an older one must keep working.
- **Stored state** — `plan`, `plans` and the chat files under the project's
  application-data directory. A chat saved by an older version must still open,
  which is why `StoredChat` keeps `plan` alongside `plans`.

## Steps

Everything must be green first. The live suites need the app running:

```bash
npm run typecheck && npm test
```

```bash
bash tests/restart-app.sh
```

```bash
npm run test:ui
```

Then the rest of the live suites — `verify-agent`, `verify-share`,
`verify-broadcast`, `verify-plugins` and the others listed in the README. Leave
the window on screen: the broadcast and visual-regression checks capture the
compositor, and an occluded window produces no frames.

Bump the version and write the entry:

```bash
npm version patch --no-git-tag-version
```

Add a section to [CHANGELOG.md](../CHANGELOG.md) describing what changed, then
commit, tag and push both:

```bash
git commit -am "Release v1.0.1"
```

```bash
git tag -a v1.0.1 -m "v1.0.1"
```

```bash
git push origin main --follow-tags
```

## Screenshots

The README's images are generated, not taken by hand — a screenshot of a UI that
has since moved documents a product that no longer exists. Regenerate them
whenever the interface changes:

```bash
node scripts/capture-shots.mjs
```

Check what you captured before committing it. The script deliberately leaves the
screen-source picker closed, because it renders live thumbnails of every window
on the machine, and those have no business in a public README.

## If a push is refused

GitHub's push protection rejects commits containing anything credential-shaped.
The security suite has to contain secret-shaped fixtures to be worth anything,
so they are assembled at runtime rather than written as literals — see
`tests/test-security.mjs`. If a new fixture trips the protection, do the same
thing to it. Do not click "allow this secret": that trains the habit and turns
the protection off for the repository that most needs it.
