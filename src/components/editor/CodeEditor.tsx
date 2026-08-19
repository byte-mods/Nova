import { useEffect, useMemo, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as monacoNs from 'monaco-editor'
import type { DebugBreakpoint } from '@shared/types'
import { useStore } from '@/state/store'
import { languageForPath } from '@/lib/language'
import { monaco } from '@/lib/monacoSetup'
import { registerCodeIntelligence, wordAt } from '@/lib/monacoProviders'
import { REFACTORINGS } from '@/lib/refactor'
import { clearActiveEditor, runRefactoring, setActiveEditor, siteFromEditor } from '@/lib/refactor/bridge'
import { relative } from '@/lib/paths'
import BlameGutter from './BlameGutter'
import Breadcrumbs from './Breadcrumbs'

export default function CodeEditor({ path }: { path: string }) {
  const buffer = useStore((s) => s.buffers[path])
  const settings = useStore((s) => s.settings)
  const debugState = useStore((s) => s.debug.state)
  const coverage = useStore((s) => s.coverage)
  const coverageVisible = useStore((s) => s.coverageVisible)
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null)
  /**
   * Decorations need the editor to exist. Mounting does not re-render on its
   * own, so without this the effects below run once against a null ref and
   * never again — which is what happens when a file is opened that already has
   * breakpoints, e.g. ones restored from a previous session.
   */
  const [mounted, setMounted] = useState(false)
  /** Line number -> test name, for the gutter run buttons. */
  const testDeclarationsRef = useRef<Map<number, string>>(new Map())

  // Model URIs must match the ones the providers hand back, otherwise Monaco
  // treats a same-file jump as a cross-file one.
  const modelPath = useMemo(() => monaco.Uri.file(path).toString(), [path])

  const onMount: OnMount = (editor, monacoApi) => {
    editorRef.current = editor
    setMounted(true)
    registerCodeIntelligence()

    // Glyph margin: the test marker runs that test, anywhere else toggles a
    // breakpoint — the same split IntelliJ and VS Code use.
    editor.onMouseDown((e) => {
      if (e.target.type !== monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      const line = e.target.position?.lineNumber
      if (!line) return
      e.event.preventDefault()
      // Right-click opens the properties dialog, the way IntelliJ's gutter does.
      if (e.event.rightButton) {
        useStore.setState({ breakpointDialog: { file: path, line } })
        return
      }
      const name = testDeclarationsRef.current.get(line)
      if (name && !e.event.altKey) {
        void useStore.getState().runTests({ kind: 'name', file: path, name })
      } else {
        void useStore.getState().toggleBreakpoint(path, line)
      }
    })

    // Keep the blame column aligned with the editor's scroll position.
    editor.onDidScrollChange((e) => {
      window.dispatchEvent(
        new CustomEvent('nova:editor-scroll', {
          detail: { path, scrollTop: e.scrollTop },
        }),
      )
    })

    let locationTimer: ReturnType<typeof setTimeout> | undefined
    editor.onDidChangeCursorPosition((e) => {
      const position = { line: e.position.lineNumber, column: e.position.column }
      // The status bar listens to the event; bookmarks and the palette need it
      // in the store, where they can read it without an editor reference.
      useStore.setState({ cursor: position })
      window.dispatchEvent(new CustomEvent('nova:cursor', { detail: position }))
      // Recent Locations records where the caret *settled*, not every line it
      // passed through while scrolling with the arrow keys.
      clearTimeout(locationTimer)
      locationTimer = setTimeout(
        () => useStore.getState().noteLocation(path, position.line, position.column),
        600,
      )
    })

    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyS, () => {
      void useStore.getState().saveBuffer(path)
    })

    // The palette and layout shortcuts must keep working while Monaco has focus.
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyP, () => {
      useStore.getState().setPalette(true, 'file')
    })
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyP, () => {
      useStore.getState().setPalette(true, 'command')
    })
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyO, () => {
      useStore.getState().setPalette(true, 'symbol')
    })
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyB, () => {
      useStore.getState().toggleSidebar()
    })
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyJ, () => {
      useStore.getState().togglePanel()
    })
    editor.addCommand(monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.KeyI, () => {
      useStore.getState().toggleAi()
    })

    const findUsagesAtCursor = () => {
      const model = editor.getModel()
      const position = editor.getPosition()
      if (!model || !position) return
      const hit = wordAt(model, position)
      if (hit?.word) void useStore.getState().findUsages(hit.word, path)
    }

    // IntelliJ's Find Usages binding, plus a context-menu entry.
    editor.addAction({
      id: 'nova.findUsages',
      label: 'Find Usages in Project',
      keybindings: [monacoApi.KeyMod.Alt | monacoApi.KeyCode.F7],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.6,
      run: findUsagesAtCursor,
    })

    editor.addAction({
      id: 'nova.goToSymbol',
      label: 'Go to Symbol in Project…',
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyO],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.7,
      run: () => useStore.getState().setPalette(true, 'symbol'),
    })

    // Inline rename. ⇧F6 opens the full Rename dialog (registered below with
    // the rest of the refactorings); F2 is the in-place variant, which runs the
    // same index-backed engine when no language server is available.
    editor.addAction({
      id: 'nova.renameInline',
      label: 'Rename Symbol In Place',
      keybindings: [monacoApi.KeyCode.F2],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.15,
      run: (ed) => ed.trigger('nova', 'editor.action.rename', null),
    })

    editor.addAction({
      id: 'nova.quickFix',
      label: 'Show Quick Fixes',
      keybindings: [monacoApi.KeyMod.Alt | monacoApi.KeyCode.Enter],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.2,
      run: (ed) => ed.trigger('nova', 'editor.action.quickFix', null),
    })

    // IntelliJ's Run to Cursor: continue, but stop here. Only meaningful while
    // a session is suspended, so it reports rather than silently doing nothing.
    editor.addAction({
      id: 'nova.runToCursor',
      label: 'Run to Cursor',
      keybindings: [monacoApi.KeyMod.Alt | monacoApi.KeyCode.F9],
      contextMenuGroupId: 'debug',
      contextMenuOrder: 1.1,
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber
        const store = useStore.getState()
        if (!line) return
        if (store.debug.state?.status !== 'paused') {
          store.notify('Run to Cursor needs a suspended debug session.', 'error')
          return
        }
        void window.nova.debug.runToLine(path, line)
      },
    })

    editor.addAction({
      id: 'nova.toggleBreakpoint',
      label: 'Toggle Breakpoint',
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.F8],
      contextMenuGroupId: 'debug',
      contextMenuOrder: 1.2,
      run: (ed) => {
        const line = ed.getPosition()?.lineNumber
        if (line) void useStore.getState().toggleBreakpoint(path, line)
      },
    })

    editor.addAction({
      id: 'nova.goToImplementation',
      label: 'Go to Implementation',
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyB],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: (ed) => ed.trigger('nova', 'editor.action.goToImplementation', null),
    })

    const hierarchyAt = (mode: 'callers' | 'supertypes') => () => {
      const position = editor.getPosition()
      if (position) {
        void useStore
          .getState()
          .showHierarchy(mode, path, position.lineNumber, position.column)
      }
    }

    editor.addAction({
      id: 'nova.callHierarchy',
      label: 'Call Hierarchy',
      keybindings: [monacoApi.KeyMod.WinCtrl | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyH],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.8,
      run: hierarchyAt('callers'),
    })

    // IntelliJ's Show History for Selection — `git log -L` on the chosen lines.
    editor.addAction({
      id: 'nova.lineHistory',
      label: 'Git: History for Selection',
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.95,
      run: async (ed) => {
        const selection = ed.getSelection()
        const from = selection?.startLineNumber ?? ed.getPosition()?.lineNumber
        const to = selection?.endLineNumber ?? from
        if (!from || !to) return
        const { openLineHistory } = await import('./LineHistoryView')
        openLineHistory(path, Math.min(from, to), Math.max(from, to))
      },
    })

    editor.addAction({
      id: 'nova.typeHierarchy',
      label: 'Type Hierarchy',
      keybindings: [monacoApi.KeyMod.WinCtrl | monacoApi.KeyCode.KeyH],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.9,
      run: hierarchyAt('supertypes'),
    })

    editor.addAction({
      id: 'nova.format',
      label: 'Reformat Code',
      keybindings: [
        monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyL,
      ],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.3,
      run: async (ed) => {
        const { formatDocument } = await import('@/lib/format')
        await formatDocument(ed, path)
      },
    })

    // IntelliJ's ⌃⌥O. Works off the file's own text, so it needs no tooling.
    editor.addAction({
      id: 'nova.optimizeImports',
      label: 'Optimize Imports',
      keybindings: [
        monacoApi.KeyMod.WinCtrl | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyO,
      ],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.35,
      run: async (ed) => {
        const { optimizeImportsIn } = await import('@/lib/format')
        await optimizeImportsIn(ed, path)
      },
    })

    /* ---- macros ---- */

    editor.addAction({
      id: 'nova.macroToggle',
      label: 'Start / Stop Macro Recording',
      keybindings: [monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyR],
      run: async (ed) => {
        const { toggleRecording } = await import('@/lib/macros')
        const node = ed.getDomNode()
        if (node) toggleRecording(node)
      },
    })

    editor.addAction({
      id: 'nova.macroPlay',
      label: 'Play Back Last Macro',
      keybindings: [
        monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyMod.Shift | monacoApi.KeyCode.KeyR,
      ],
      run: async (ed) => {
        const { playMacro } = await import('@/lib/macros')
        const node = ed.getDomNode()
        if (node) {
          await playMacro(node, (text) => ed.trigger('macro', 'type', { text }))
        }
      },
    })

    /* ---- refactorings ---- */

    // Keep the bridge pointed at whichever editor the user last touched, so
    // the palette and ⌃T still know where to act after focus moves away.
    setActiveEditor(editor, path)
    editor.onDidFocusEditorText(() => setActiveEditor(editor, path))

    editor.addAction({
      id: 'nova.refactorThis',
      label: 'Refactor This…',
      keybindings: [monacoApi.KeyMod.WinCtrl | monacoApi.KeyCode.KeyT],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.05,
      run: (ed) => {
        setActiveEditor(ed, path)
        useStore.setState({ refactorMenuOpen: true })
      },
    })

    // IntelliJ's default keymap, one action per refactoring.
    const BINDINGS: Partial<Record<(typeof REFACTORINGS)[number]['id'], number>> = {
      rename: monacoApi.KeyMod.Shift | monacoApi.KeyCode.F6,
      'extract.variable': monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyV,
      'extract.constant': monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyC,
      'extract.field': monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyF,
      'extract.method': monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyM,
      'extract.parameter': monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyP,
      'inline.variable': monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyN,
      'signature.change': monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.F6,
      'move.file': monacoApi.KeyCode.F6,
      safeDelete: monacoApi.KeyMod.CtrlCmd | monacoApi.KeyCode.Backspace,
    }

    let order = 2
    for (const descriptor of REFACTORINGS) {
      const keybinding = BINDINGS[descriptor.id]
      editor.addAction({
        id: `nova.refactor.${descriptor.id}`,
        label: `Refactor: ${descriptor.label}`,
        keybindings: keybinding ? [keybinding] : undefined,
        contextMenuGroupId: '1_modification',
        contextMenuOrder: 2 + order++ / 100,
        run: (ed) => {
          setActiveEditor(ed, path)
          const site = siteFromEditor(ed, path)
          if (site) void runRefactoring(descriptor.id, site)
        },
      })
    }
  }

  useEffect(() => () => clearActiveEditor(path), [path])

  // Gutter run buttons next to each test declaration.
  useEffect(() => {
    let disposed = false
    let collection: monacoNs.editor.IEditorDecorationsCollection | null = null

    const refresh = async () => {
      const editor = editorRef.current
      if (!editor) return
      const declarations = await window.nova.tests.declarations(path).catch(() => [])
      if (disposed) return
      testDeclarationsRef.current = new Map(declarations.map((d) => [d.line, d.name]))
      collection?.clear()
      if (declarations.length === 0) return
      collection = editor.createDecorationsCollection(
        declarations.map((declaration) => ({
          range: new monaco.Range(declaration.line, 1, declaration.line, 1),
          options: {
            glyphMarginClassName: 'nova-test-glyph',
            glyphMarginHoverMessage: { value: `Run \`${declaration.name}\`` },
            stickiness: 1,
          },
        })),
      )
    }

    void refresh()
    const timer = setInterval(refresh, 4000)
    return () => {
      disposed = true
      clearInterval(timer)
      collection?.clear()
    }
  }, [path, buffer?.savedContent, mounted])

  // Breakpoint markers and the paused-line highlight.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const entry = debugState?.breakpoints.find((b) => b.file === path)
    const verified = new Set(entry?.verified ?? [])
    const items: DebugBreakpoint[] =
      entry?.items ?? (entry?.lines ?? []).map((line) => ({ line, enabled: true }))
    const decorations: monacoNs.editor.IModelDeltaDecoration[] = items.map((bp) => {
      // A log point and a conditional breakpoint behave differently enough at
      // runtime that they should not look identical in the gutter.
      const kind = bp.logMessage ? 'log' : bp.condition || bp.hitCondition ? 'conditional' : ''
      const classes = ['nova-breakpoint']
      if (kind) classes.push(kind)
      if (!bp.enabled) classes.push('disabled')
      else if (!verified.has(bp.line)) classes.push('unverified')

      const detail = [
        bp.logMessage ? `Log point: \`${bp.logMessage}\`` : 'Breakpoint',
        bp.condition ? `Condition: \`${bp.condition}\`` : '',
        bp.hitCondition ? `Hit count: \`${bp.hitCondition}\`` : '',
        !bp.enabled ? '_disabled_' : verified.has(bp.line) ? '' : '_not yet bound_',
        '',
        'Right-click for properties.',
      ]
        .filter(Boolean)
        .join('  \n')

      return {
        range: new monaco.Range(bp.line, 1, bp.line, 1),
        options: {
          glyphMarginClassName: classes.join(' '),
          glyphMarginHoverMessage: { value: detail },
          stickiness: 1,
        },
      }
    })

    const frame = debugState?.frames.find((f) => f.id === debugState.currentFrameId)
    if (debugState?.status === 'paused' && frame?.file === path) {
      decorations.push({
        range: new monaco.Range(frame.line, 1, frame.line, 1),
        options: {
          isWholeLine: true,
          className: 'nova-debug-line',
          glyphMarginClassName: 'nova-debug-arrow',
        },
      })
    }

    const collection = editor.createDecorationsCollection(decorations)
    return () => collection.clear()
  }, [path, debugState, mounted])

  /**
   * Coverage stripes in the margin.
   *
   * A thin coloured bar rather than a line highlight: coverage is background
   * information you want visible while reading code, and a full-width tint over
   * every uncovered line makes the code itself harder to read.
   */
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !coverageVisible || !coverage) return

    const file = coverage.files.find((f) => f.path === path)
    if (!file) return

    const partial = new Set(file.partial)
    const decorations: monacoNs.editor.IModelDeltaDecoration[] = []

    for (const [rawLine, hits] of Object.entries(file.lines)) {
      const line = Number(rawLine)
      const isPartial = partial.has(line)
      if (hits > 0 && !isPartial) {
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: { linesDecorationsClassName: 'nova-cov covered', stickiness: 1 },
        })
      } else {
        decorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            linesDecorationsClassName: `nova-cov ${isPartial ? 'partial' : 'uncovered'}`,
            hoverMessage: {
              value: isPartial ? 'Some branches on this line were never taken.' : 'Not covered by any test.',
            },
            stickiness: 1,
          },
        })
      }
    }

    const collection = editor.createDecorationsCollection(decorations)
    return () => collection.clear()
  }, [path, coverage, coverageVisible, mounted])

  useEffect(() => {
    const goto = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path: string; line: number; column?: number }
      if (detail.path !== path || !editorRef.current) return
      editorRef.current.revealLineInCenter(detail.line)
      editorRef.current.setPosition({
        lineNumber: detail.line,
        column: detail.column ?? 1,
      })
      editorRef.current.focus()
    }
    window.addEventListener('nova:goto-line', goto)
    return () => window.removeEventListener('nova:goto-line', goto)
  }, [path])

  // Push where the editor is, so anyone watching a share follows along. The
  // subscription is cheap when nothing is shared: the main process drops the
  // update if there are no viewers.
  useEffect(() => {
    if (!buffer) return
    const timer = setTimeout(() => {
      void window.nova.share
        .presence({ activeFile: relative(useStore.getState().root ?? '', path), content: buffer.content })
        .catch(() => undefined)
    }, 250)
    return () => clearTimeout(timer)
  }, [path, buffer?.content])

  if (!buffer) return <div className="empty-state">Loading…</div>

  const editorNode = (
    <Editor
      path={modelPath}
      language={languageForPath(path)}
      value={buffer.content}
      theme={settings.themeId}
      onMount={onMount}
      onChange={(value) => useStore.getState().updateBuffer(path, value ?? '')}
      options={{
        fontSize: settings.fontSize,
        lineHeight: Math.round(settings.fontSize * 1.5),
        fontFamily: settings.fontFamily,
        fontLigatures: true,
        tabSize: settings.tabSize,
        wordWrap: settings.wordWrap ? 'on' : 'off',
        minimap: { enabled: settings.minimap, renderCharacters: false },
        lineNumbers: settings.lineNumbers ? 'on' : 'off',
        glyphMargin: true,
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        renderLineHighlight: 'all',
        padding: { top: 12, bottom: 40 },
        scrollBeyondLastLine: false,
        bracketPairColorization: { enabled: true },
        // Monaco's standalone themes report semantic highlighting as off, and
        // the default 'configuredByTheme' believes them — so it has to be
        // turned on explicitly or the semantic token providers never run.
        'semanticHighlighting.enabled': true,
        guides: { bracketPairs: true, indentation: true },
        automaticLayout: true,
        stickyScroll: { enabled: true },
        suggestSelection: 'first',
        wordBasedSuggestions: 'allDocuments',
        quickSuggestions: { other: true, comments: false, strings: false },
        formatOnPaste: true,
        inlayHints: { enabled: settings.inlayHints ? 'on' : 'off' },
        definitionLinkOpensInPeek: false,
        gotoLocation: {
          multiple: 'goto',
          multipleDefinitions: 'goto',
          multipleReferences: 'peek',
        },
        scrollbar: { verticalScrollbarSize: 11, horizontalScrollbarSize: 11 },
      }}
    />
  )

  const body = settings.showBlame ? (
    <div className="editor-with-blame">
      <BlameGutter path={path} lineHeight={Math.round(settings.fontSize * 1.5)} />
      <div style={{ flex: 1, minWidth: 0 }}>{editorNode}</div>
    </div>
  ) : (
    editorNode
  )

  if (!settings.breadcrumbs) return body

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Breadcrumbs path={path} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>{body}</div>
    </div>
  )
}
