/**
 * Reading build systems: what can be run, and what is depended on.
 *
 * Detection is cheap and file-based; task lists are read from the build file
 * where possible and only fall back to invoking the tool when the file cannot
 * tell us (Gradle, mainly, where tasks are defined by plugins rather than
 * declared). Dependency resolution always shells out — that is genuinely the
 * tool's job and any local approximation would be wrong in the cases that
 * matter, like conflict resolution.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { BuildProject, BuildTask, DependencyNode } from '../../shared/build'
import { toolEnv } from './env'

const exec = promisify(execFile)

/** Gradle in particular can take a while on a cold daemon. */
const TASK_TIMEOUT_MS = 3 * 60 * 1000

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

export async function detectBuildProjects(root: string): Promise<BuildProject[]> {
  const projects: BuildProject[] = []

  if ((await exists(path.join(root, 'build.gradle'))) || (await exists(path.join(root, 'build.gradle.kts')))) {
    projects.push(await gradleProject(root))
  }
  if (await exists(path.join(root, 'pom.xml'))) {
    projects.push(await mavenProject(root))
  }
  if (await exists(path.join(root, 'package.json'))) {
    projects.push(await nodeProject(root))
  }
  if (await exists(path.join(root, 'Cargo.toml'))) {
    projects.push(await cargoProject(root))
  }
  if (await exists(path.join(root, 'Makefile'))) {
    projects.push(await makeProject(root))
  }

  return projects
}

/* ---------------- npm / pnpm / yarn ---------------- */

async function nodeProject(root: string): Promise<BuildProject> {
  const file = path.join(root, 'package.json')
  const project: BuildProject = {
    tool: 'npm',
    label: 'npm',
    file,
    command: 'npm',
    tasks: [],
  }

  // The lockfile decides the tool: running `npm` in a pnpm workspace produces a
  // different tree from the one the project actually uses.
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) {
    project.tool = 'pnpm'
    project.label = 'pnpm'
    project.command = 'pnpm'
  } else if (await exists(path.join(root, 'yarn.lock'))) {
    project.tool = 'yarn'
    project.label = 'Yarn'
    project.command = 'yarn'
  }

  try {
    const pkg = JSON.parse(await fs.readFile(file, 'utf8')) as {
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    project.tasks = Object.entries(pkg.scripts ?? {}).map(([name, script]) => ({
      id: `run:${name}`,
      name,
      description: script,
      group: 'Scripts',
    }))
    project.dependencies = [
      ...depNodes(pkg.dependencies, 'dependencies'),
      ...depNodes(pkg.devDependencies, 'devDependencies'),
    ]
  } catch (err) {
    project.error = `Could not read package.json: ${message(err)}`
  }

  return project
}

function depNodes(deps: Record<string, string> | undefined, scope: string): DependencyNode[] {
  return Object.entries(deps ?? {}).map(([name, version]) => ({
    id: `${scope}:${name}`,
    name,
    version,
    scope,
    children: [],
  }))
}

/* ---------------- Gradle ---------------- */

async function gradleProject(root: string): Promise<BuildProject> {
  const wrapper = path.join(root, 'gradlew')
  const command = (await exists(wrapper)) ? './gradlew' : 'gradle'
  return {
    tool: 'gradle',
    label: 'Gradle',
    file: (await exists(path.join(root, 'build.gradle.kts')))
      ? path.join(root, 'build.gradle.kts')
      : path.join(root, 'build.gradle'),
    command,
    // Common lifecycle tasks, shown immediately. `loadGradleTasks` replaces
    // these with the real list, which needs a daemon start we do not want to
    // pay for just because the panel was opened.
    tasks: [
      { id: 'build', name: 'build', description: 'Assemble and test the project', group: 'Build' },
      { id: 'assemble', name: 'assemble', description: 'Assemble the outputs', group: 'Build' },
      { id: 'clean', name: 'clean', description: 'Delete the build directory', group: 'Build' },
      { id: 'test', name: 'test', description: 'Run the unit tests', group: 'Verification' },
      { id: 'check', name: 'check', description: 'Run all checks', group: 'Verification' },
    ],
  }
}

/** Runs `gradle tasks` and parses its grouped output. */
export async function loadGradleTasks(root: string, command: string): Promise<BuildTask[]> {
  const { stdout } = await run(root, command, ['tasks', '--all', '--console=plain', '-q'])
  const tasks: BuildTask[] = []
  let group = 'Other'

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (!line) continue
    // Group headings are a line of text followed by a line of dashes.
    if (/^[A-Z][\w ]+ tasks$/.test(line)) {
      group = line.replace(/ tasks$/, '')
      continue
    }
    if (/^-+$/.test(line)) continue
    const match = /^([\w:.-]+)(?:\s+-\s+(.*))?$/.exec(line)
    if (!match) continue
    tasks.push({ id: match[1], name: match[1], description: match[2] ?? '', group })
  }
  return tasks
}

/* ---------------- Maven ---------------- */

async function mavenProject(root: string): Promise<BuildProject> {
  const wrapper = path.join(root, 'mvnw')
  const command = (await exists(wrapper)) ? './mvnw' : 'mvn'
  const project: BuildProject = {
    tool: 'maven',
    label: 'Maven',
    file: path.join(root, 'pom.xml'),
    command,
    tasks: [
      { id: 'clean', name: 'clean', description: 'Delete target/', group: 'Lifecycle' },
      { id: 'compile', name: 'compile', description: 'Compile the sources', group: 'Lifecycle' },
      { id: 'test', name: 'test', description: 'Run the unit tests', group: 'Lifecycle' },
      { id: 'package', name: 'package', description: 'Build the artifact', group: 'Lifecycle' },
      { id: 'verify', name: 'verify', description: 'Run checks on the built artifact', group: 'Lifecycle' },
      { id: 'install', name: 'install', description: 'Install into the local repository', group: 'Lifecycle' },
    ],
  }

  // Declared dependencies come straight from the POM without invoking Maven,
  // which keeps the panel useful offline. `loadDependencies` gets the resolved
  // tree when the user asks for it.
  try {
    const pom = await fs.readFile(project.file, 'utf8')
    project.dependencies = parsePomDependencies(pom)
  } catch (err) {
    project.error = `Could not read pom.xml: ${message(err)}`
  }

  return project
}

export function parsePomDependencies(pom: string): DependencyNode[] {
  const out: DependencyNode[] = []
  // Only the <dependencies> inside <project>, not <dependencyManagement>.
  const withoutManagement = pom.replace(/<dependencyManagement>[\s\S]*?<\/dependencyManagement>/g, '')
  for (const match of withoutManagement.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const body = match[1]
    const group = /<groupId>(.*?)<\/groupId>/.exec(body)?.[1]?.trim() ?? ''
    const artifact = /<artifactId>(.*?)<\/artifactId>/.exec(body)?.[1]?.trim() ?? ''
    const version = /<version>(.*?)<\/version>/.exec(body)?.[1]?.trim() ?? 'managed'
    const scope = /<scope>(.*?)<\/scope>/.exec(body)?.[1]?.trim() ?? 'compile'
    if (!artifact) continue
    out.push({ id: `${group}:${artifact}`, name: group ? `${group}:${artifact}` : artifact, version, scope, children: [] })
  }
  return out
}

/**
 * Parses `mvn dependency:tree`, whose output is an indented ASCII tree.
 *
 * Depth comes from the position of the branch character rather than counting
 * spaces, because Maven pads with a mix of `|`, `+` and spaces.
 */
export function parseMavenTree(stdout: string): DependencyNode[] {
  const roots: DependencyNode[] = []
  const stack: { depth: number; node: DependencyNode }[] = []
  let index = 0

  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.replace(/^\[INFO\]\s?/, '')
    const marker = /[+\\]-\s/.exec(line)
    if (!marker) continue

    const depth = Math.floor(marker.index / 3) + 1
    const coordinate = line.slice(marker.index + marker[0].length).trim()
    // group:artifact:packaging:version:scope
    const parts = coordinate.split(':')
    if (parts.length < 4) continue

    const node: DependencyNode = {
      id: `${coordinate}#${index++}`,
      name: `${parts[0]}:${parts[1]}`,
      version: parts[3],
      scope: parts[4] ?? 'compile',
      children: [],
    }

    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ depth, node })
  }

  return roots
}

/* ---------------- Cargo ---------------- */

async function cargoProject(root: string): Promise<BuildProject> {
  const project: BuildProject = {
    tool: 'cargo',
    label: 'Cargo',
    file: path.join(root, 'Cargo.toml'),
    command: 'cargo',
    tasks: [
      { id: 'build', name: 'build', description: 'Compile the package', group: 'Build' },
      { id: 'run', name: 'run', description: 'Build and run the binary', group: 'Build' },
      { id: 'test', name: 'test', description: 'Run the tests', group: 'Verification' },
      { id: 'clippy', name: 'clippy', description: 'Lint with Clippy', group: 'Verification' },
      { id: 'fmt', name: 'fmt', description: 'Format the sources', group: 'Verification' },
      { id: 'clean', name: 'clean', description: 'Remove target/', group: 'Build' },
    ],
  }

  try {
    const toml = await fs.readFile(project.file, 'utf8')
    project.dependencies = parseCargoDependencies(toml)
  } catch (err) {
    project.error = `Could not read Cargo.toml: ${message(err)}`
  }
  return project
}

/** Minimal TOML reading: just the dependency tables, which are flat. */
export function parseCargoDependencies(toml: string): DependencyNode[] {
  const out: DependencyNode[] = []
  const sections = toml.split(/^\[/m)
  for (const section of sections) {
    const header = section.slice(0, section.indexOf(']'))
    if (!/^(dev-|build-)?dependencies$/.test(header)) continue
    const scope = header
    for (const raw of section.slice(section.indexOf(']') + 1).split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const match = /^([\w-]+)\s*=\s*(.*)$/.exec(line)
      if (!match) continue
      const value = match[2].trim()
      const version = value.startsWith('"')
        ? value.slice(1, value.indexOf('"', 1))
        : (/version\s*=\s*"([^"]+)"/.exec(value)?.[1] ?? '*')
      out.push({ id: `${scope}:${match[1]}`, name: match[1], version, scope, children: [] })
    }
  }
  return out
}

/* ---------------- Make ---------------- */

async function makeProject(root: string): Promise<BuildProject> {
  const file = path.join(root, 'Makefile')
  const project: BuildProject = { tool: 'make', label: 'Make', file, command: 'make', tasks: [] }
  try {
    const text = await fs.readFile(file, 'utf8')
    const seen = new Set<string>()
    for (const raw of text.split(/\r?\n/)) {
      // A target is `name:` at the start of a line, not a variable assignment
      // and not a pattern rule.
      const match = /^([A-Za-z0-9][\w.-]*)\s*:(?!=)/.exec(raw)
      if (!match || seen.has(match[1])) continue
      seen.add(match[1])
      project.tasks.push({ id: match[1], name: match[1], description: '', group: 'Targets' })
    }
  } catch (err) {
    project.error = `Could not read Makefile: ${message(err)}`
  }
  return project
}

/* ---------------- Dependencies on demand ---------------- */

export async function loadDependencies(root: string, project: BuildProject): Promise<DependencyNode[]> {
  switch (project.tool) {
    case 'maven': {
      const { stdout } = await run(root, project.command, ['dependency:tree', '-B'])
      return parseMavenTree(stdout)
    }
    case 'gradle': {
      const { stdout } = await run(root, project.command, ['dependencies', '--console=plain', '-q'])
      return parseGradleTree(stdout)
    }
    case 'cargo': {
      // `cargo tree` is the only one of these that is fast enough to just run.
      const { stdout } = await run(root, 'cargo', ['tree', '--prefix', 'depth'])
      return parseCargoTree(stdout)
    }
    default: {
      // npm/pnpm/yarn: the declared set is already loaded, and a full resolved
      // tree in a large workspace is tens of thousands of nodes.
      return project.dependencies ?? []
    }
  }
}

export function parseGradleTree(stdout: string): DependencyNode[] {
  const roots: DependencyNode[] = []
  const stack: { depth: number; node: DependencyNode }[] = []
  let index = 0
  let scope = 'compile'

  for (const raw of stdout.split(/\r?\n/)) {
    const configuration = /^(\w+)\s+-\s/.exec(raw)
    if (configuration) {
      scope = configuration[1]
      continue
    }
    const marker = /[+\\]---\s/.exec(raw)
    if (!marker) continue

    const depth = Math.floor(marker.index / 5) + 1
    let coordinate = raw.slice(marker.index + marker[0].length).trim()
    let resolvedFrom: string | undefined
    // Gradle annotates conflict resolution as `1.0 -> 2.0`.
    const arrow = coordinate.indexOf(' -> ')
    if (arrow !== -1) {
      resolvedFrom = coordinate.slice(0, arrow).split(':').pop()
      coordinate = `${coordinate.slice(0, arrow).split(':').slice(0, 2).join(':')}:${coordinate.slice(arrow + 4)}`
    }
    coordinate = coordinate.replace(/\s*\(\*\)\s*$/, '').replace(/\s*\(n\)\s*$/, '')

    const parts = coordinate.split(':')
    if (parts.length < 2) continue

    const node: DependencyNode = {
      id: `${coordinate}#${index++}`,
      name: `${parts[0]}:${parts[1]}`,
      version: parts[2] ?? '',
      scope,
      children: [],
      resolvedFrom,
    }

    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ depth, node })
  }

  return roots
}

export function parseCargoTree(stdout: string): DependencyNode[] {
  const roots: DependencyNode[] = []
  const stack: { depth: number; node: DependencyNode }[] = []
  let index = 0

  for (const raw of stdout.split(/\r?\n/)) {
    const match = /^(\d+)(\S+)\s+v(\S+)/.exec(raw.trim())
    if (!match) continue
    const depth = Number(match[1])
    const node: DependencyNode = {
      id: `${match[2]}@${match[3]}#${index++}`,
      name: match[2],
      version: match[3],
      scope: 'dependencies',
      children: [],
    }
    while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else roots.push(node)
    stack.push({ depth, node })
  }
  return roots
}

/* ---------------- shared ---------------- */

function run(cwd: string, command: string, args: string[]) {
  return exec(command, args, {
    cwd,
    timeout: TASK_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: toolEnv(),
  })
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
