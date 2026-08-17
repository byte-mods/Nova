/**
 * Docker, Kubernetes and SSH in one tool window.
 *
 * Three tabs rather than three panels: they are used in the same "what is
 * running, and can I get a shell on it" moment, and the bottom panel has room
 * for one more tab, not three.
 *
 * Anything interactive opens in the terminal. A container shell or an SSH
 * session needs a PTY and needs to be interruptible, and the terminal already
 * is both.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Boxes,
  Container,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Server,
  Square,
  TerminalSquare,
  Trash2,
} from 'lucide-react'
import { useStore } from '@/state/store'
import type {
  DockerContainer,
  DockerImage,
  KubeContext,
  KubeResource,
  SshHost,
  ToolAvailability,
} from '@shared/infra'

type Tab = 'docker' | 'kube' | 'ssh'

export default function InfraView() {
  const [tab, setTab] = useState<Tab>('docker')
  const [available, setAvailable] = useState<ToolAvailability | null>(null)

  useEffect(() => {
    void window.nova.infra.available().then(setAvailable)
  }, [])

  return (
    <div className="infra-view">
      <div className="infra-head">
        <div className="segmented">
          <button className={tab === 'docker' ? 'active' : ''} onClick={() => setTab('docker')}>
            <Container size={11} /> Docker
          </button>
          <button className={tab === 'kube' ? 'active' : ''} onClick={() => setTab('kube')}>
            <Boxes size={11} /> Kubernetes
          </button>
          <button className={tab === 'ssh' ? 'active' : ''} onClick={() => setTab('ssh')}>
            <Server size={11} /> SSH
          </button>
        </div>
      </div>

      {tab === 'docker' && <DockerTab available={available?.docker} />}
      {tab === 'kube' && <KubeTab available={available?.kubectl} />}
      {tab === 'ssh' && <SshTab available={available?.ssh} />}
    </div>
  )
}

/** Opens a command in the terminal panel, which owns the PTY. */
function runInTerminal(command: string) {
  useStore.getState().togglePanel('terminal')
  window.dispatchEvent(new CustomEvent('nova:run-command', { detail: { command } }))
}

function MissingTool({ binary, hint }: { binary: string; hint: string }) {
  return (
    <div className="empty-state" style={{ flexDirection: 'column', gap: 6 }}>
      <AlertTriangle size={16} className="faint" />
      <span className="faint" style={{ fontSize: 12 }}>
        <code className="mono">{binary}</code> is not on PATH.
      </span>
      <span className="faint" style={{ fontSize: 10.5 }}>
        {hint}
      </span>
    </div>
  )
}

function DockerTab({ available }: { available?: boolean }) {
  const [containers, setContainers] = useState<DockerContainer[]>([])
  const [images, setImages] = useState<DockerImage[]>([])
  const [showAll, setShowAll] = useState(true)
  const [showImages, setShowImages] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (available === false) return
    setBusy(true)
    setError('')
    try {
      if (showImages) setImages(await window.nova.infra.dockerImages())
      else setContainers(await window.nova.infra.dockerContainers(showAll))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [available, showAll, showImages])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (available === false) {
    return <MissingTool binary="docker" hint="Install Docker Desktop or the docker CLI." />
  }

  const act = async (action: string, id: string) => {
    try {
      await window.nova.infra.dockerAction(action, id)
      await refresh()
    } catch (err) {
      useStore.getState().notify(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  return (
    <>
      <div className="infra-toolbar">
        <div className="segmented">
          <button className={!showImages ? 'active' : ''} onClick={() => setShowImages(false)}>
            Containers
          </button>
          <button className={showImages ? 'active' : ''} onClick={() => setShowImages(true)}>
            Images
          </button>
        </div>
        {!showImages && (
          <label className="infra-check">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Include stopped
          </label>
        )}
        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => void refresh()}>
          {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && <div className="infra-error">{error}</div>}

      <div className="infra-list">
        {!showImages &&
          containers.map((container) => {
            const running = container.state === 'running'
            return (
              <div key={container.id} className="infra-row">
                <span className={`infra-dot ${running ? 'on' : ''}`} />
                <span className="infra-name">{container.name}</span>
                <span className="infra-sub mono">{container.image}</span>
                <span className="infra-sub">{container.status}</span>
                <span className="infra-sub mono">{container.ports}</span>
                <span className="infra-actions">
                  <button
                    className="icon-btn"
                    title={running ? 'Stop' : 'Start'}
                    onClick={() => void act(running ? 'stop' : 'start', container.id)}
                  >
                    {running ? <Square size={11} /> : <Play size={11} />}
                  </button>
                  <button
                    className="icon-btn"
                    title="Shell into this container"
                    onClick={() => runInTerminal(`docker exec -it ${container.id} sh`)}
                  >
                    <TerminalSquare size={11} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Follow logs"
                    onClick={() => runInTerminal(`docker logs -f --tail 200 ${container.id}`)}
                  >
                    <FileText size={11} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Remove"
                    onClick={() => {
                      if (confirm(`Remove container ${container.name}?`)) void act('remove', container.id)
                    }}
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              </div>
            )
          })}

        {showImages &&
          images.map((image) => (
            <div key={image.id + image.tag} className="infra-row">
              <span className="infra-name mono">
                {image.repository}:{image.tag}
              </span>
              <span className="infra-sub">{image.size}</span>
              <span className="infra-sub">{image.created}</span>
              <span className="infra-actions">
                <button
                  className="icon-btn"
                  title="Run this image"
                  onClick={() => runInTerminal(`docker run --rm -it ${image.repository}:${image.tag} sh`)}
                >
                  <Play size={11} />
                </button>
              </span>
            </div>
          ))}

        {!busy && !error && (showImages ? !images.length : !containers.length) && (
          <p className="faint" style={{ padding: 12, fontSize: 11.5 }}>
            Nothing to show.
          </p>
        )}
      </div>
    </>
  )
}

function KubeTab({ available }: { available?: boolean }) {
  const [contexts, setContexts] = useState<KubeContext[]>([])
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [namespace, setNamespace] = useState('*')
  const [kind, setKind] = useState('pods')
  const [rows, setRows] = useState<KubeResource[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (available === false) return
    void (async () => {
      try {
        setContexts(await window.nova.infra.kubeContexts())
        setNamespaces(await window.nova.infra.kubeNamespaces())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [available])

  const refresh = useCallback(async () => {
    if (available === false) return
    setBusy(true)
    setError('')
    try {
      setRows(await window.nova.infra.kubeResources(kind, namespace))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [available, kind, namespace])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (available === false) {
    return <MissingTool binary="kubectl" hint="Install kubectl and configure a cluster context." />
  }

  const current = contexts.find((c) => c.current)

  return (
    <>
      <div className="infra-toolbar">
        <select
          value={current?.name ?? ''}
          onChange={async (e) => {
            await window.nova.infra.kubeUse(e.target.value)
            setContexts(await window.nova.infra.kubeContexts())
            void refresh()
          }}
        >
          {contexts.map((context) => (
            <option key={context.name} value={context.name}>
              {context.name}
            </option>
          ))}
        </select>

        <select value={namespace} onChange={(e) => setNamespace(e.target.value)}>
          <option value="*">all namespaces</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>

        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {['pods', 'deployments', 'services', 'statefulsets', 'jobs', 'nodes'].map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>

        <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => void refresh()}>
          {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
        </button>
      </div>

      {error && <div className="infra-error">{error}</div>}

      <div className="infra-list">
        {rows.map((row) => (
          <div key={`${row.namespace}/${row.name}`} className="infra-row">
            <span className={`infra-dot ${/running|ready|active|bound/i.test(row.status) ? 'on' : ''}`} />
            <span className="infra-name">{row.name}</span>
            {row.namespace && <span className="infra-sub">{row.namespace}</span>}
            <span className="infra-sub">{row.ready}</span>
            <span className="infra-sub">{row.status}</span>
            <span className="infra-sub">{row.age}</span>
            <span className="infra-actions">
              {kind === 'pods' && (
                <>
                  <button
                    className="icon-btn"
                    title="Follow logs"
                    onClick={() =>
                      runInTerminal(
                        `kubectl logs -f --tail 200 ${row.name}${row.namespace ? ` -n ${row.namespace}` : ''}`,
                      )
                    }
                  >
                    <FileText size={11} />
                  </button>
                  <button
                    className="icon-btn"
                    title="Shell into this pod"
                    onClick={() =>
                      runInTerminal(
                        `kubectl exec -it ${row.name}${row.namespace ? ` -n ${row.namespace}` : ''} -- sh`,
                      )
                    }
                  >
                    <TerminalSquare size={11} />
                  </button>
                </>
              )}
            </span>
          </div>
        ))}
        {!busy && !error && !rows.length && (
          <p className="faint" style={{ padding: 12, fontSize: 11.5 }}>
            No {kind} found.
          </p>
        )}
      </div>
    </>
  )
}

function SshTab({ available }: { available?: boolean }) {
  const [hosts, setHosts] = useState<SshHost[]>([])

  useEffect(() => {
    if (available === false) return
    void window.nova.infra.sshHosts().then(setHosts)
  }, [available])

  if (available === false) {
    return <MissingTool binary="ssh" hint="An SSH client is part of every mainstream OS." />
  }

  return (
    <div className="infra-list">
      {!hosts.length && (
        <p className="faint" style={{ padding: 12, fontSize: 11.5, lineHeight: 1.6 }}>
          No hosts in <code className="mono">~/.ssh/config</code>. Add a{' '}
          <code className="mono">Host</code> block and they will appear here.
        </p>
      )}
      {hosts.map((host) => (
        <div key={host.name} className="infra-row">
          <Server size={11} className="faint" />
          <span className="infra-name">{host.name}</span>
          <span className="infra-sub mono">
            {host.user ? `${host.user}@` : ''}
            {host.hostname}
            {host.port !== '22' ? `:${host.port}` : ''}
          </span>
          <span className="infra-actions">
            <button
              className="icon-btn"
              title="Open a session in the terminal"
              onClick={() => runInTerminal(`ssh ${host.name}`)}
            >
              <TerminalSquare size={11} />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}
