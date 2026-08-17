import fs from 'node:fs/promises'
import path from 'node:path'
import type { RunConfig, RunConfigEntry } from '../../shared/types'

/**
 * Composes a shell command from an entry's parts.
 *
 * Before-launch steps are joined with `&&` so a failing build stops the run;
 * env vars become a `VAR=value` prefix; `cwd` becomes a subshell `cd` so the
 * terminal's own working directory is untouched afterwards.
 */
export function composeCommand(entry: RunConfigEntry, all: RunConfigEntry[], depth = 0): string {
  // A compound runs its members in parallel and waits for all of them —
  // the dev-server-plus-worker shape compounds exist for.
  if (entry.compound?.length) {
    if (depth > 3) return 'echo "compound configurations nest too deeply"'
    const parts = entry.compound
      .map((name) => all.find((candidate) => candidate.name === name))
      .filter((found): found is RunConfigEntry => Boolean(found))
      .map((found) => composeCommand(found, all, depth + 1))
    if (parts.length === 0) return 'echo "compound configuration has no members"'
    return `${parts.map((part) => `(${part}) &`).join(' ')} wait`
  }

  const env = Object.entries(entry.env ?? {})
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(' ')
  const main = [env, entry.command ?? '', entry.args ?? ''].filter(Boolean).join(' ')
  const steps = [...(entry.before ?? []).filter(Boolean), main]
  const joined = steps.join(' && ')
  return entry.cwd ? `(cd ${shellQuote(entry.cwd)} && ${joined})` : joined
}

function shellQuote(value: string): string {
  if (/^[\w./=:-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Reads `.nova/run.json` into editable entries. */
export async function readRunConfigEntries(root: string): Promise<RunConfigEntry[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(root, '.nova', 'run.json'), 'utf8'))
    const list = Array.isArray(raw) ? raw : (raw.configurations ?? [])
    return list.filter((entry: RunConfigEntry) => entry && typeof entry.name === 'string')
  } catch {
    return []
  }
}

export async function writeRunConfigEntries(root: string, entries: RunConfigEntry[]): Promise<void> {
  const dir = path.join(root, '.nova')
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'run.json'), JSON.stringify({ configurations: entries }, null, 2))
}

/**
 * Run configurations. Anything obvious about the project is detected, and the
 * user's own entries in `.nova/run.json` are merged on top.
 */
export async function detectRunConfigs(root: string): Promise<RunConfig[]> {
  const configs: RunConfig[] = []
  let rootFiles = new Set<string>()
  try {
    rootFiles = new Set(await fs.readdir(root))
  } catch {
    return configs
  }

  if (rootFiles.has('package.json')) {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
      const manager = rootFiles.has('pnpm-lock.yaml')
        ? 'pnpm'
        : rootFiles.has('yarn.lock')
          ? 'yarn'
          : rootFiles.has('bun.lockb')
            ? 'bun'
            : 'npm'
      for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
        configs.push({
          id: `npm:${name}`,
          label: `${manager} run ${name}`,
          command: `${manager} run ${name}`,
          detail: String(script).slice(0, 90),
          source: 'detected',
        })
      }
    } catch {
      /* unparseable package.json */
    }
  }

  if (rootFiles.has('Cargo.toml')) {
    configs.push(
      { id: 'cargo:run', label: 'cargo run', command: 'cargo run', detail: '', source: 'detected' },
      { id: 'cargo:build', label: 'cargo build', command: 'cargo build', detail: '', source: 'detected' },
    )
  }
  if (rootFiles.has('go.mod')) {
    configs.push(
      { id: 'go:run', label: 'go run .', command: 'go run .', detail: '', source: 'detected' },
      { id: 'go:build', label: 'go build ./...', command: 'go build ./...', detail: '', source: 'detected' },
    )
  }
  if (rootFiles.has('Makefile')) {
    configs.push({ id: 'make', label: 'make', command: 'make', detail: '', source: 'detected' })
  }
  if (rootFiles.has('pyproject.toml') || rootFiles.has('requirements.txt')) {
    if (rootFiles.has('main.py')) {
      configs.push({ id: 'py:main', label: 'python main.py', command: 'python3 main.py', detail: '', source: 'detected' })
    }
  }
  if (rootFiles.has('docker-compose.yml') || rootFiles.has('compose.yaml')) {
    configs.push({ id: 'compose', label: 'docker compose up', command: 'docker compose up', detail: '', source: 'detected' })
  }
  if (rootFiles.has('pom.xml')) {
    configs.push({ id: 'mvn', label: 'mvn spring-boot:run', command: 'mvn spring-boot:run', detail: '', source: 'detected' })
  }
  if (rootFiles.has('build.gradle') || rootFiles.has('build.gradle.kts')) {
    configs.push({ id: 'gradle:run', label: './gradlew run', command: './gradlew run', detail: '', source: 'detected' })
  }

  // User overrides / additions. Compound entries and before-launch steps are
  // composed into one shell command here, so the terminal runner stays dumb.
  const entries = await readRunConfigEntries(root)
  for (const entry of [...entries].reverse()) {
    if (!entry.command && !entry.compound?.length) continue
    configs.unshift({
      id: `custom:${entry.name}`,
      label: entry.name,
      command: composeCommand(entry, entries),
      detail:
        entry.detail ??
        (entry.compound?.length
          ? `compound: ${entry.compound.join(' + ')}`
          : entry.before?.length
            ? `after: ${entry.before.join(' && ')}`
            : ''),
      source: 'custom',
    })
  }

  return configs
}

export async function writeSampleRunConfig(root: string) {
  const dir = path.join(root, '.nova')
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, 'run.json')
  try {
    await fs.access(file)
  } catch {
    await fs.writeFile(
      file,
      JSON.stringify(
        {
          configurations: [
            { name: 'Dev server', command: 'npm run dev', detail: 'Starts the app in watch mode' },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )
  }
  return file
}
