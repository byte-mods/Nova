/**
 * Known language servers. Nothing is bundled — each entry is probed on PATH and
 * only used when the user already has it installed, so the IDE keeps working
 * (on the built-in symbol index) when none are present.
 */
export interface ServerSpec {
  id: string
  label: string
  /** Monaco language ids this server handles. */
  languages: string[]
  command: string
  args: string[]
  /** Files/dirs that mark the project root for this server. */
  rootMarkers: string[]
  /** Sent as `initializationOptions`. */
  initializationOptions?: Record<string, unknown>
  /** Answers to `workspace/configuration`, keyed by requested section. */
  settings?: Record<string, unknown>
  install: string
  /** Resolve through `xcrun --find` when absent from PATH (Xcode toolchain). */
  xcrun?: boolean
}

export const SERVERS: ServerSpec[] = [
  {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    languages: ['typescript', 'javascript'],
    command: 'typescript-language-server',
    args: ['--stdio'],
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    install: 'npm i -g typescript-language-server typescript',
  },
  {
    id: 'pyright',
    label: 'Python (Pyright)',
    languages: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio'],
    rootMarkers: ['pyproject.toml', 'setup.py', 'requirements.txt', 'Pipfile'],
    settings: {
      python: { analysis: { autoSearchPaths: true, useLibraryCodeForTypes: true } },
    },
    install: 'npm i -g pyright',
  },
  {
    id: 'pylsp',
    label: 'Python (pylsp)',
    languages: ['python'],
    command: 'pylsp',
    args: [],
    rootMarkers: ['pyproject.toml', 'setup.py', 'requirements.txt'],
    install: 'pipx install python-lsp-server',
  },
  {
    id: 'gopls',
    label: 'Go',
    languages: ['go'],
    command: 'gopls',
    args: [],
    rootMarkers: ['go.mod', 'go.work'],
    install: 'go install golang.org/x/tools/gopls@latest',
  },
  {
    id: 'rust-analyzer',
    label: 'Rust',
    languages: ['rust'],
    command: 'rust-analyzer',
    args: [],
    rootMarkers: ['Cargo.toml', 'rust-project.json'],
    settings: {
      'rust-analyzer': {
        checkOnSave: { command: 'check' },
        cargo: { buildScripts: { enable: true } },
        procMacro: { enable: true },
      },
    },
    install: 'rustup component add rust-analyzer',
  },
  {
    id: 'clangd',
    label: 'C / C++ / Objective-C',
    languages: ['c', 'cpp', 'objective-c'],
    command: 'clangd',
    args: ['--background-index', '--clang-tidy'],
    rootMarkers: ['compile_commands.json', '.clangd', 'CMakeLists.txt', 'Makefile'],
    install: 'brew install llvm  (or xcode-select --install)',
    xcrun: true,
  },
  {
    id: 'sourcekit-lsp',
    label: 'Swift',
    languages: ['swift'],
    command: 'sourcekit-lsp',
    args: [],
    rootMarkers: ['Package.swift', '*.xcodeproj'],
    install: 'ships with Xcode / Swift toolchain',
    xcrun: true,
  },
  {
    id: 'jdtls',
    label: 'Java',
    languages: ['java'],
    command: 'jdtls',
    args: [],
    rootMarkers: ['pom.xml', 'build.gradle', 'build.gradle.kts', '.project'],
    install: 'brew install jdtls',
  },
  {
    id: 'kotlin',
    label: 'Kotlin',
    languages: ['kotlin'],
    command: 'kotlin-language-server',
    args: [],
    rootMarkers: ['build.gradle.kts', 'build.gradle', 'settings.gradle'],
    install: 'brew install kotlin-language-server',
  },
  {
    id: 'omnisharp',
    label: 'C#',
    languages: ['csharp'],
    command: 'csharp-ls',
    args: [],
    rootMarkers: ['*.sln', '*.csproj'],
    install: 'dotnet tool install -g csharp-ls',
  },
  {
    id: 'ruby-lsp',
    label: 'Ruby',
    languages: ['ruby'],
    command: 'ruby-lsp',
    args: [],
    rootMarkers: ['Gemfile', '.ruby-version'],
    install: 'gem install ruby-lsp',
  },
  {
    id: 'solargraph',
    label: 'Ruby (Solargraph)',
    languages: ['ruby'],
    command: 'solargraph',
    args: ['stdio'],
    rootMarkers: ['Gemfile', '.solargraph.yml'],
    install: 'gem install solargraph',
  },
  {
    id: 'intelephense',
    label: 'PHP',
    languages: ['php'],
    command: 'intelephense',
    args: ['--stdio'],
    rootMarkers: ['composer.json'],
    install: 'npm i -g intelephense',
  },
  {
    id: 'dart',
    label: 'Dart / Flutter',
    languages: ['dart'],
    command: 'dart',
    args: ['language-server', '--client-id=nova-ide'],
    rootMarkers: ['pubspec.yaml'],
    install: 'ships with the Dart/Flutter SDK',
  },
  {
    id: 'elixir-ls',
    label: 'Elixir',
    languages: ['elixir'],
    command: 'elixir-ls',
    args: [],
    rootMarkers: ['mix.exs'],
    install: 'brew install elixir-ls',
  },
  {
    id: 'lua',
    label: 'Lua',
    languages: ['lua'],
    command: 'lua-language-server',
    args: [],
    rootMarkers: ['.luarc.json'],
    install: 'brew install lua-language-server',
  },
  {
    id: 'bash',
    label: 'Shell',
    languages: ['shell'],
    command: 'bash-language-server',
    args: ['start'],
    rootMarkers: [],
    install: 'npm i -g bash-language-server',
  },
  {
    id: 'yaml',
    label: 'YAML',
    languages: ['yaml'],
    command: 'yaml-language-server',
    args: ['--stdio'],
    rootMarkers: [],
    install: 'npm i -g yaml-language-server',
  },
  {
    id: 'json',
    label: 'JSON',
    languages: ['json'],
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    rootMarkers: [],
    install: 'npm i -g vscode-langservers-extracted',
  },
  {
    id: 'html',
    label: 'HTML',
    languages: ['html'],
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    rootMarkers: [],
    install: 'npm i -g vscode-langservers-extracted',
  },
  {
    id: 'css',
    label: 'CSS / SCSS / Less',
    languages: ['css', 'scss', 'less'],
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    rootMarkers: [],
    install: 'npm i -g vscode-langservers-extracted',
  },
  {
    id: 'terraform',
    label: 'Terraform',
    languages: ['hcl'],
    command: 'terraform-ls',
    args: ['serve'],
    rootMarkers: ['.terraform', '*.tf'],
    install: 'brew install hashicorp/tap/terraform-ls',
  },
  {
    id: 'haskell',
    label: 'Haskell',
    languages: ['haskell'],
    command: 'haskell-language-server-wrapper',
    args: ['--lsp'],
    rootMarkers: ['stack.yaml', 'cabal.project', '*.cabal'],
    install: 'ghcup install hls',
  },
  {
    id: 'sqls',
    label: 'SQL',
    languages: ['sql'],
    command: 'sqls',
    args: [],
    rootMarkers: [],
    install: 'go install github.com/sqls-server/sqls@latest',
  },
]

/** Servers that can serve a given Monaco language, in preference order. */
export function serversForLanguage(language: string): ServerSpec[] {
  return SERVERS.filter((s) => s.languages.includes(language))
}
