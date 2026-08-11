import fs from 'node:fs/promises'
import path from 'node:path'
import type { RunConfig } from '../../shared/types'

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

  // User overrides / additions.
  try {
    const custom = JSON.parse(await fs.readFile(path.join(root, '.nova', 'run.json'), 'utf8'))
    for (const entry of Array.isArray(custom) ? custom : (custom.configurations ?? [])) {
      if (!entry?.command) continue
      configs.unshift({
        id: `custom:${entry.name ?? entry.command}`,
        label: entry.name ?? entry.command,
        command: entry.command,
        detail: entry.detail ?? '',
        source: 'custom',
      })
    }
  } catch {
    /* no custom config */
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
