/**
 * Debug adapters, probed on PATH exactly like the language servers. Nothing is
 * bundled; the app degrades to "no debugger for this language" when none exist.
 */
export interface AdapterSpec {
  id: string
  label: string
  languages: string[]
  command: string
  args: string[]
  /** Extra fields merged into the `launch` request. */
  launchDefaults: Record<string, unknown>
  /**
   * How to turn the user's program into something the adapter can launch.
   * `binary` means it must be compiled first; `script` runs the file directly.
   */
  programKind: 'binary' | 'script'
  install: string
  /** Adapters that need the initialize response before `launch`. */
  launchAfterInitialize?: boolean
  /** Resolve through `xcrun --find` when absent from PATH (Xcode toolchain). */
  xcrun?: boolean
}

export const ADAPTERS: AdapterSpec[] = [
  {
    id: 'debugpy',
    label: 'Python (debugpy)',
    languages: ['python'],
    command: 'python3',
    args: ['-m', 'debugpy.adapter'],
    launchDefaults: { console: 'internalConsole', justMyCode: true },
    programKind: 'script',
    install: 'pip install debugpy',
  },
  {
    id: 'delve',
    label: 'Go (Delve)',
    languages: ['go'],
    command: 'dlv',
    args: ['dap'],
    launchDefaults: { mode: 'debug' },
    programKind: 'script',
    install: 'go install github.com/go-delve/delve/cmd/dlv@latest',
  },
  {
    id: 'lldb-dap',
    label: 'C / C++ / Rust / Swift (lldb-dap)',
    languages: ['c', 'cpp', 'objective-c', 'rust', 'swift'],
    command: 'lldb-dap',
    args: [],
    launchDefaults: {},
    programKind: 'binary',
    install: 'ships with Xcode / LLVM (xcrun --find lldb-dap)',
    xcrun: true,
  },
  {
    id: 'codelldb',
    label: 'Rust / C++ (CodeLLDB)',
    languages: ['rust', 'c', 'cpp'],
    command: 'codelldb',
    args: ['--port', '0'],
    launchDefaults: {},
    programKind: 'binary',
    install: 'install the CodeLLDB release and put `codelldb` on PATH',
  },
  {
    id: 'js-debug',
    label: 'Node / TypeScript (vscode-js-debug)',
    languages: ['javascript', 'typescript'],
    command: 'js-debug-adapter',
    args: [],
    launchDefaults: { type: 'pwa-node', console: 'internalConsole', sourceMaps: true },
    programKind: 'script',
    install: 'npm i -g js-debug-adapter',
  },
]

export function adaptersForLanguage(language: string) {
  return ADAPTERS.filter((a) => a.languages.includes(language))
}
