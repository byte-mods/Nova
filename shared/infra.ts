/**
 * Docker, Kubernetes and SSH, as the Infrastructure tool window needs them.
 *
 * As with the database console, Nova drives the tools the user already has —
 * `docker`, `kubectl`, `ssh` — rather than reimplementing their protocols. Their
 * config, contexts and credentials are already set up, and an editor that
 * quietly used a different Kubernetes context from the terminal beside it would
 * be actively dangerous.
 */

export interface DockerContainer {
  id: string
  name: string
  image: string
  /** Docker's own status text, e.g. "Up 3 hours". */
  status: string
  state: string
  ports: string
}

export interface DockerImage {
  id: string
  repository: string
  tag: string
  size: string
  created: string
}

export interface KubeContext {
  name: string
  cluster: string
  namespace: string
  current: boolean
}

export interface KubeResource {
  kind: string
  name: string
  namespace: string
  /** Ready column, e.g. "2/2". */
  ready: string
  status: string
  restarts: string
  age: string
}

export interface SshHost {
  /** Host alias from ~/.ssh/config, or a user-entered one. */
  name: string
  hostname: string
  user: string
  port: string
  /** True when it came from ~/.ssh/config rather than Nova's own list. */
  fromConfig: boolean
}

export interface ToolAvailability {
  docker: boolean
  kubectl: boolean
  ssh: boolean
}
