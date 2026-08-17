/**
 * Build systems, as the Build tool window needs them.
 *
 * One shape for Gradle, Maven, npm, Cargo and Make: a list of things you can
 * run and a tree of what you depend on. The differences between them live in
 * the adapters, not here — the panel should not care which one it is showing.
 */

export interface BuildTask {
  /** Unique within the project. */
  id: string
  /** What the user types, e.g. `test`, `clean build`, `run dev`. */
  name: string
  description: string
  /** Grouping heading, e.g. "Verification", "Scripts". */
  group: string
}

export interface DependencyNode {
  id: string
  /** `group:artifact` for JVM, package name elsewhere. */
  name: string
  version: string
  /** e.g. "compile", "test", "dev", "optional". */
  scope: string
  children: DependencyNode[]
  /** Set when a resolution rule changed the requested version. */
  resolvedFrom?: string
}

export interface BuildProject {
  /** `gradle` | `maven` | `npm` | `pnpm` | `yarn` | `cargo` | `make` */
  tool: string
  label: string
  /** Absolute path to the build file this was read from. */
  file: string
  /** Command used to invoke the tool, e.g. `./gradlew`. */
  command: string
  tasks: BuildTask[]
  /** Populated lazily: resolving dependencies can be slow. */
  dependencies?: DependencyNode[]
  /** Set when the tool is present but something went wrong reading it. */
  error?: string
}
