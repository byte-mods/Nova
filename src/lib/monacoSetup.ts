import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { monacoThemeData, themes } from '@/theme/themes'

let done = false

/**
 * Monaco is bundled locally (never fetched from a CDN, which the app's CSP
 * blocks) and every Nova theme is registered up front so switching is instant.
 */
export function setupMonacoEnvironment() {
  if (done) return
  done = true

  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      switch (label) {
        case 'json':
          return new jsonWorker()
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker()
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker()
        case 'typescript':
        case 'javascript':
          return new tsWorker()
        default:
          return new editorWorker()
      }
    },
  }

  for (const theme of themes) {
    monaco.editor.defineTheme(theme.id, monacoThemeData(theme) as monaco.editor.IStandaloneThemeData)
  }

  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: false,
  })
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ESNext,
    allowNonTsExtensions: true,
    moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
    jsx: monaco.languages.typescript.JsxEmit.React,
    allowJs: true,
  })

  loader.config({ monaco })
}

export { monaco }
