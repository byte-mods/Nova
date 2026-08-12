import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useStore } from '@/state/store'
import { getTheme } from '@/theme/themes'
import { basename } from '@/lib/paths'

interface Props {
  id: string
  visible: boolean
}

/**
 * A real terminal.
 *
 * When node-pty is available the shell runs on a pseudo-terminal and this
 * component is a dumb pipe: keystrokes go straight to the tty and output comes
 * straight back, so the shell owns the prompt, line editing, history, job
 * control and any full-screen program the user launches.
 *
 * Without the native module it falls back to the original model — one child
 * process per command, with the prompt and history drawn here. That path
 * cannot run interactive programs, and says so on open.
 */
export default function TerminalView({ id, visible }: Props) {
  const root = useStore((s) => s.root)
  const themeId = useStore((s) => s.settings.themeId)
  const fontSize = useStore((s) => s.settings.fontSize)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyRef = useRef(false)
  const stateRef = useRef({
    line: '',
    cwd: root ?? '~',
    busy: false,
    history: [] as string[],
    historyIndex: -1,
  })

  useEffect(() => {
    if (!hostRef.current) return
    const theme = getTheme(themeId)
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'SF Mono', Menlo, monospace",
      fontSize,
      cursorBlink: true,
      // A pty already sends CRLF; converting again double-spaces every line.
      convertEol: false,
      scrollback: 8000,
      allowProposedApi: true,
      theme: {
        background: theme.colors.panel,
        foreground: theme.colors.text,
        cursor: theme.colors.cursor,
        selectionBackground: theme.colors.selection,
        black: theme.colors.bgInset,
        red: theme.colors.danger,
        green: theme.colors.success,
        yellow: theme.colors.warning,
        blue: theme.colors.accent,
        magenta: theme.syntax.keyword,
        cyan: theme.syntax.type,
        white: theme.colors.text,
        brightBlack: theme.colors.textFaint,
        brightRed: theme.colors.danger,
        brightGreen: theme.colors.success,
        brightYellow: theme.colors.warning,
        brightBlue: theme.colors.accent,
        brightMagenta: theme.syntax.keyword,
        brightCyan: theme.syntax.type,
        brightWhite: theme.colors.text,
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(hostRef.current)
    try {
      fit.fit()
    } catch {
      /* zero-sized while hidden */
    }
    termRef.current = term
    fitRef.current = fit
    stateRef.current.cwd = root ?? '~'

    let disposed = false
    let onData: { dispose(): void } | null = null

    void (async () => {
      const result = await window.nova.shell
        .open(id, root ?? process.cwd?.() ?? '.', term.cols, term.rows)
        .catch(() => ({ pty: false, reason: 'the terminal backend did not start' }))
      if (disposed) return
      ptyRef.current = result.pty

      if (result.pty) {
        // Everything the user types belongs to the tty, including Ctrl+C,
        // arrow keys and anything a full-screen program is listening for.
        onData = term.onData((data) => void window.nova.shell.input(id, data))
      } else {
        term.writeln(
          '\x1b[33mRunning without a pseudo-terminal — interactive programs (vim, top, less) are unavailable.\x1b[0m',
        )
        term.writeln('\x1b[2mNova terminal — commands run in the project folder.\x1b[0m')
        prompt(term, stateRef.current.cwd)
        onData = term.onData((data) => handleFallbackInput(term, data))
      }
    })()

    const handleFallbackInput = (term: Terminal, data: string) => {
      const state = stateRef.current
      if (state.busy) {
        if (data === '\x03') void window.nova.shell.kill(id)
        else void window.nova.shell.input(id, data)
        return
      }

      if (data === '\r') {
        const command = state.line.trim()
        term.write('\r\n')
        state.line = ''
        state.historyIndex = -1
        if (!command) {
          prompt(term, state.cwd)
          return
        }
        state.history.unshift(command)
        state.busy = true
        void window.nova.shell.spawn(id, root ?? '.', command)
        return
      }

      if (data === '\x7f') {
        if (state.line.length > 0) {
          state.line = state.line.slice(0, -1)
          term.write('\b \b')
        }
        return
      }

      if (data === '\x03') {
        term.write('^C\r\n')
        state.line = ''
        prompt(term, state.cwd)
        return
      }

      if (data === '\x1b[A' || data === '\x1b[B') {
        const next =
          data === '\x1b[A'
            ? Math.min(state.historyIndex + 1, state.history.length - 1)
            : Math.max(state.historyIndex - 1, -1)
        state.historyIndex = next
        const replacement = next === -1 ? '' : state.history[next]
        term.write('\r\x1b[K')
        prompt(term, state.cwd, false)
        term.write(replacement)
        state.line = replacement
        return
      }

      if (data.startsWith('\x1b')) return

      state.line += data
      term.write(data)
    }

    const offData = window.nova.shell.onData((chunk) => {
      if (chunk.id !== id) return
      // Only the fallback path emits bare newlines; a tty sends proper CRLF.
      term.write(ptyRef.current ? chunk.data : chunk.data.replace(/(?<!\r)\n/g, '\r\n'))
    })

    const offExit = window.nova.shell.onExit((payload) => {
      if (payload.id !== id) return
      if (ptyRef.current) {
        term.writeln(`\r\n\x1b[2m[shell exited with ${payload.code ?? 0}]\x1b[0m`)
        return
      }
      const state = stateRef.current
      state.busy = false
      if (payload.code && payload.code !== 0) {
        term.writeln(`\x1b[31mexit ${payload.code}\x1b[0m`)
      }
      const nextCwd = (payload as { cwd?: string }).cwd
      if (nextCwd) state.cwd = nextCwd
      prompt(term, state.cwd)
    })

    const runCommand = (e: Event) => {
      const detail = (e as CustomEvent).detail as { command: string }
      if (!detail?.command) return
      if (ptyRef.current) {
        void window.nova.shell.input(id, `${detail.command}\r`)
        return
      }
      if (stateRef.current.busy) return
      term.write(`${detail.command}\r\n`)
      stateRef.current.busy = true
      void window.nova.shell.spawn(id, root ?? '.', detail.command)
    }
    window.addEventListener('nova:run-command', runCommand)

    const observer = new ResizeObserver(() => {
      try {
        fit.fit()
        // The shell needs the new window size or `tput cols`, `less` and every
        // full-screen program keep drawing at the old one.
        if (ptyRef.current) void window.nova.shell.resize(id, term.cols, term.rows)
      } catch {
        /* the pane can be zero-sized while hidden */
      }
    })
    observer.observe(hostRef.current)

    // A shell holds its own working directory, so one opened in the previous
    // project must be retired rather than reused. The effect re-runs on `root`,
    // which rebuilds the terminal around a fresh shell.
    const onProjectChanged = () => void window.nova.shell.dispose(id)
    window.addEventListener('nova:project-changed', onProjectChanged)

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('nova:run-command', runCommand)
      window.removeEventListener('nova:project-changed', onProjectChanged)
      onData?.dispose()
      offData()
      offExit()
      term.dispose()
      termRef.current = null
    }
  }, [id, root, themeId, fontSize])

  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        try {
          fitRef.current?.fit()
          const term = termRef.current
          if (term && ptyRef.current) void window.nova.shell.resize(id, term.cols, term.rows)
          term?.focus()
        } catch {
          /* ignore */
        }
      }, 30)
    }
  }, [visible, id])

  return <div className="terminal-host" ref={hostRef} />
}

function prompt(term: Terminal, cwd: string, newline = true) {
  const label = basename(cwd) || cwd
  if (newline) term.write('\r')
  term.write(`\x1b[38;5;110m${label}\x1b[0m \x1b[38;5;245m❯\x1b[0m `)
}
