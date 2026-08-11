import { useEffect, useMemo, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type * as monacoNs from 'monaco-editor'
import { useStore } from '@/state/store'
import { languageForPath } from '@/lib/language'
import { monaco } from '@/lib/monacoSetup'
import { registerCodeIntelligence, wordAt } from '@/lib/monacoProviders'
import BlameGutter from './BlameGutter'

export default function CodeEditor({ path }: { path: string }) {
  const buffer = useStore((s) => s.buffers[path])
  const settings = useStore((s) => s.settings)
  const debugState = useStore((s) => s.debug.state)
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null)
  /** Line number -> test name, for the gutter run buttons. */
  const testDeclarationsRef = useRef<Map<number, string>>(new Map())

  // Model URIs must match the ones the providers hand back, otherwise Monaco
  // treats a same-file jump as a cross-file one.
  const modelPath = useMemo(() => monaco.Uri.file(path).toString(), [path])

  const onMount: OnMount = (editor, monacoApi) => {
    editorRef.current = editor
    registerCodeIntelligence()

    // Glyph margin: the test marker runs that test, anywhere else toggles a
    // breakpoint — the same split IntelliJ and VS Code use.
    editor.onMouseDown((e) => {
      if (e.target.type !== monacoApi.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
      const line = e.target.position?.lineNumber
      if (!line) return
      e.event.preventDefault()
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

    editor.onDidChangeCursorPosition((e) => {
      window.dispatchEvent(
        new CustomEvent('nova:cursor', {
          detail: { line: e.position.lineNumber, column: e.position.column },
        }),
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

    // IntelliJ bindings for the language-server refactorings.
    editor.addAction({
      id: 'nova.rename',
      label: 'Rename Symbol (language server)',
      keybindings: [monacoApi.KeyMod.Shift | monacoApi.KeyCode.F6],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.1,
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
      label: 'Format Document',
      keybindings: [
        monacoApi.KeyMod.CtrlCmd | monacoApi.KeyMod.Alt | monacoApi.KeyCode.KeyL,
      ],
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1.3,
      run: (ed) => ed.trigger('nova', 'editor.action.formatDocument', null),
    })
  }

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
  }, [path, buffer?.savedContent])

  // Breakpoint markers and the paused-line highlight.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const lines = debugState?.breakpoints.find((b) => b.file === path)
    const verified = new Set(lines?.verified ?? [])
    const decorations: monacoNs.editor.IModelDeltaDecoration[] = (lines?.lines ?? []).map(
      (line) => ({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: verified.has(line)
            ? 'nova-breakpoint'
            : 'nova-breakpoint unverified',
          glyphMarginHoverMessage: {
            value: verified.has(line) ? 'Breakpoint' : 'Breakpoint (not yet bound)',
          },
          stickiness: 1,
        },
      }),
    )

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
  }, [path, debugState])

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

  if (!settings.showBlame) return editorNode

  return (
    <div className="editor-with-blame">
      <BlameGutter path={path} lineHeight={Math.round(settings.fontSize * 1.5)} />
      <div style={{ flex: 1, minWidth: 0 }}>{editorNode}</div>
    </div>
  )
}
