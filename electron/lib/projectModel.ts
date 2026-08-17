/**
 * The project model: modules, SDKs and frameworks, detected rather than
 * configured.
 *
 * A module is any directory with its own build manifest — `package.json`,
 * `go.mod`, `Cargo.toml`, `pom.xml`, and so on. IntelliJ makes you declare
 * this in `.iml` files; here the manifests already on disk *are* the model,
 * and the detection just reads them. Frameworks ("facets") come from each
 * module's dependency list, and inter-module dependencies from workspace
 * references between manifests.
 */

import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { toolEnv } from './env'

const exec = promisify(execFile)

export interface ProjectModule {
  /** Directory relative to the root; '' is the root module. */
  dir: string
  name: string
  /** Which manifest made it a module. */
  manifest: string
  language: string
  /** Framework "facets" recognised from its dependencies. */
  frameworks: string[]
  /** Names of other modules in this project it depends on. */
  dependsOn: string[]
  /** Declared runtime constraint, e.g. `node >=18`, when the manifest has one. */
  engine: string
}

export interface SdkInfo {
  id: string
  label: string
  /** Resolved version string, or '' when the tool is not installed. */
  version: string
  binary: string
}

export interface ProjectModel {
  modules: ProjectModule[]
  sdks: SdkInfo[]
}

/* ---------------- framework recognition ---------------- */

/** Dependency name -> facet label, per ecosystem. */
const JS_FRAMEWORKS: [string, string][] = [
  ['next', 'Next.js'],
  ['react', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['@angular/core', 'Angular'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['electron', 'Electron'],
  ['vite', 'Vite'],
  ['jest', 'Jest'],
  ['vitest', 'Vitest'],
  ['typescript', 'TypeScript'],
  ['tailwindcss', 'Tailwind'],
  ['prisma', 'Prisma'],
  ['@nestjs/core', 'NestJS'],
]

const PY_FRAMEWORKS: [string, string][] = [
  ['django', 'Django'],
  ['flask', 'Flask'],
  ['fastapi', 'FastAPI'],
  ['pytest', 'pytest'],
  ['sqlalchemy', 'SQLAlchemy'],
  ['pydantic', 'Pydantic'],
  ['celery', 'Celery'],
  ['numpy', 'NumPy'],
  ['torch', 'PyTorch'],
]

const JAVA_FRAMEWORKS: [string, string][] = [
  ['spring-boot', 'Spring Boot'],
  ['org.springframework', 'Spring'],
  ['jakarta.persistence', 'JPA'],
  ['javax.persistence', 'JPA'],
  ['hibernate', 'Hibernate'],
  ['io.quarkus', 'Quarkus'],
  ['io.micronaut', 'Micronaut'],
  ['junit', 'JUnit'],
  ['com.android', 'Android'],
]

const RUST_FRAMEWORKS: [string, string][] = [
  ['tokio', 'Tokio'],
  ['actix-web', 'Actix'],
  ['axum', 'Axum'],
  ['rocket', 'Rocket'],
  ['serde', 'Serde'],
  ['diesel', 'Diesel'],
]

const GO_FRAMEWORKS: [string, string][] = [
  ['github.com/gin-gonic/gin', 'Gin'],
  ['github.com/labstack/echo', 'Echo'],
  ['github.com/gofiber/fiber', 'Fiber'],
  ['google.golang.org/grpc', 'gRPC'],
  ['k8s.io/', 'Kubernetes'],
]

function matchFrameworks(haystack: string, table: [string, string][]): string[] {
  const found = new Set<string>()
  for (const [needle, label] of table) {
    if (haystack.includes(needle)) found.add(label)
  }
  return [...found]
}

/* ---------------- module discovery ---------------- */

const MODULE_MANIFESTS = [
  'package.json',
  'go.mod',
  'Cargo.toml',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pyproject.toml',
  'requirements.txt',
  'Gemfile',
  'composer.json',
  'Package.swift',
  'pubspec.yaml',
]

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'target', 'vendor', '.venv', 'venv',
  '__pycache__', '.next', '.cache', 'coverage', 'release',
])

/** Directories containing a manifest, up to three levels deep. */
async function findModuleDirs(root: string): Promise<{ dir: string; manifest: string }[]> {
  const found: { dir: string; manifest: string }[] = []

  async function scan(dir: string, depth: number): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(dir)
    } catch {
      return
    }
    const names = new Set(entries)
    const manifest = MODULE_MANIFESTS.find((candidate) => names.has(candidate))
    if (manifest) {
      found.push({ dir: path.relative(root, dir), manifest })
    }
    if (depth >= 3) return
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
      const full = path.join(dir, entry)
      try {
        const stat = await fs.stat(full)
        if (stat.isDirectory()) await scan(full, depth + 1)
      } catch {
        /* ignore */
      }
    }
  }

  await scan(root, 0)
  return found
}

async function readModule(root: string, dir: string, manifest: string): Promise<ProjectModule> {
  const full = path.join(root, dir)
  const name = dir === '' ? path.basename(root) : dir
  const module: ProjectModule = {
    dir,
    name,
    manifest,
    language: '',
    frameworks: [],
    dependsOn: [],
    engine: '',
  }

  const readText = async (file: string) => {
    try {
      return await fs.readFile(path.join(full, file), 'utf8')
    } catch {
      return ''
    }
  }

  switch (manifest) {
    case 'package.json': {
      module.language = 'JavaScript / TypeScript'
      try {
        const pkg = JSON.parse(await readText('package.json'))
        if (pkg.name) module.name = pkg.name
        const deps = { ...pkg.dependencies, ...pkg.devDependencies }
        module.frameworks = matchFrameworks(Object.keys(deps).join(' '), JS_FRAMEWORKS)
        if (pkg.engines?.node) module.engine = `node ${pkg.engines.node}`
        // Workspace references become module edges once every name is known.
        module.dependsOn = Object.entries<string>(deps)
          .filter(([, version]) => typeof version === 'string' && /^(workspace:|file:|link:)/.test(version))
          .map(([depName]) => depName)
      } catch {
        /* unparseable */
      }
      break
    }
    case 'go.mod': {
      module.language = 'Go'
      const text = await readText('go.mod')
      const moduleName = /^module\s+(\S+)/m.exec(text)?.[1]
      if (moduleName) module.name = moduleName
      const goVersion = /^go\s+(\S+)/m.exec(text)?.[1]
      if (goVersion) module.engine = `go ${goVersion}`
      module.frameworks = matchFrameworks(text, GO_FRAMEWORKS)
      break
    }
    case 'Cargo.toml': {
      module.language = 'Rust'
      const text = await readText('Cargo.toml')
      const crateName = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1]
      if (crateName) module.name = crateName
      module.frameworks = matchFrameworks(text, RUST_FRAMEWORKS)
      module.dependsOn = [...text.matchAll(/^\s*([\w-]+)\s*=\s*\{[^}]*path\s*=/gm)].map((m) => m[1])
      break
    }
    case 'pom.xml': {
      module.language = 'Java'
      const text = await readText('pom.xml')
      const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(text)?.[1]
      if (artifact) module.name = artifact
      const javaVersion = /<java\.version>([^<]+)</.exec(text)?.[1] ?? /<maven\.compiler\.source>([^<]+)</.exec(text)?.[1]
      if (javaVersion) module.engine = `java ${javaVersion}`
      module.frameworks = matchFrameworks(text, JAVA_FRAMEWORKS)
      break
    }
    case 'build.gradle':
    case 'build.gradle.kts': {
      module.language = 'Java / Kotlin'
      const text = await readText(manifest)
      module.frameworks = matchFrameworks(text, JAVA_FRAMEWORKS)
      module.dependsOn = [...text.matchAll(/project\(["':]+([\w:-]+)["']?\)/g)].map((m) =>
        m[1].replace(/^:/, ''),
      )
      break
    }
    case 'pyproject.toml':
    case 'requirements.txt': {
      module.language = 'Python'
      const text = `${await readText('pyproject.toml')}\n${await readText('requirements.txt')}`
      const pyName = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1]
      if (pyName) module.name = pyName
      const pyVersion = /requires-python\s*=\s*"([^"]+)"/.exec(text)?.[1]
      if (pyVersion) module.engine = `python ${pyVersion}`
      module.frameworks = matchFrameworks(text.toLowerCase(), PY_FRAMEWORKS)
      break
    }
    case 'Gemfile':
      module.language = 'Ruby'
      break
    case 'composer.json': {
      module.language = 'PHP'
      const text = await readText('composer.json')
      if (text.includes('laravel')) module.frameworks.push('Laravel')
      if (text.includes('symfony')) module.frameworks.push('Symfony')
      break
    }
    case 'Package.swift':
      module.language = 'Swift'
      break
    case 'pubspec.yaml': {
      module.language = 'Dart'
      const text = await readText('pubspec.yaml')
      if (text.includes('flutter')) module.frameworks.push('Flutter')
      break
    }
  }

  return module
}

/* ---------------- SDK detection ---------------- */

const SDK_PROBES: { id: string; label: string; command: string; args: string[] }[] = [
  { id: 'node', label: 'Node.js', command: 'node', args: ['--version'] },
  { id: 'python', label: 'Python', command: 'python3', args: ['--version'] },
  { id: 'go', label: 'Go', command: 'go', args: ['version'] },
  { id: 'rust', label: 'Rust', command: 'rustc', args: ['--version'] },
  { id: 'java', label: 'Java', command: 'java', args: ['-version'] },
  { id: 'ruby', label: 'Ruby', command: 'ruby', args: ['--version'] },
  { id: 'php', label: 'PHP', command: 'php', args: ['--version'] },
  { id: 'swift', label: 'Swift', command: 'swift', args: ['--version'] },
  { id: 'dotnet', label: '.NET', command: 'dotnet', args: ['--version'] },
]

async function detectSdks(): Promise<SdkInfo[]> {
  return Promise.all(
    SDK_PROBES.map(async (probe) => {
      try {
        const { stdout, stderr } = await exec(probe.command, probe.args, {
          env: toolEnv(),
          timeout: 4000,
        })
        // `java -version` prints to stderr.
        const version = (stdout || stderr).trim().split('\n')[0].slice(0, 80)
        const { stdout: whichOut } = await exec('which', [probe.command], { env: toolEnv() }).catch(
          () => ({ stdout: '' }),
        )
        return { id: probe.id, label: probe.label, version, binary: whichOut.trim() }
      } catch {
        return { id: probe.id, label: probe.label, version: '', binary: '' }
      }
    }),
  )
}

/* ---------------- entry point ---------------- */

export async function buildProjectModel(root: string): Promise<ProjectModel> {
  const dirs = await findModuleDirs(root)
  const modules = await Promise.all(dirs.map(({ dir, manifest }) => readModule(root, dir, manifest)))

  // Resolve declared dependency names against the discovered module set, so
  // `dependsOn` only carries edges the graph can actually draw.
  const byName = new Map(modules.map((module) => [module.name, module]))
  for (const module of modules) {
    module.dependsOn = module.dependsOn
      .filter((name) => byName.has(name) && name !== module.name)
      .sort()
  }

  modules.sort((a, b) => a.dir.localeCompare(b.dir))
  return { modules, sdks: await detectSdks() }
}
