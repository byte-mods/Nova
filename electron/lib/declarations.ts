import type { SymbolKind } from '../../shared/types'

export interface DeclarationRule {
  re: RegExp
  kind: SymbolKind
  /** Capture group holding the identifier. Defaults to 1. */
  group?: number
  /** Marks the symbol as opening a container (class/module) for nested members. */
  opensContainer?: boolean
  /** Rename the kind to 'method' when the match is inside a container. */
  methodInContainer?: boolean
  /**
   * Only match at indentation zero. Used for bindings that are worth indexing
   * project-wide (module globals) but not when they are function locals.
   */
  topLevelOnly?: boolean
}

const ID = '[A-Za-z_$][\\w$]*'

/**
 * Per-language declaration patterns. These are deliberately line-oriented and
 * conservative: a missed declaration only costs a ranking hint (the reference
 * scan still finds the identifier), whereas a false positive would send
 * Cmd+click to the wrong place.
 */
export const RULES: Record<string, DeclarationRule[]> = {
  typescript: [
    { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:export\s+)?(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/, kind: 'interface', opensContainer: true },
    { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/, kind: 'enum', opensContainer: true },
    { re: /^\s*(?:export\s+)?(?:declare\s+)?namespace\s+([A-Za-z_$][\w$]*)/, kind: 'module', opensContainer: true },
    { re: /^\s*(?:export\s+)?(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/, kind: 'type' },
    { re: /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function' },
    // `const foo = (a) => …` and `const foo = function …`
    { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=>)/, kind: 'function', topLevelOnly: true },
    { re: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)/, kind: 'constant', topLevelOnly: true },
    { re: /^\s*(?:export\s+)?(?:let|var)\s+([A-Za-z_$][\w$]*)/, kind: 'variable', topLevelOnly: true },
    // Class/interface members: require a body or a type annotation so calls do not match.
    { re: /^\s+(?:(?:public|private|protected|static|readonly|async|override|abstract|get|set)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^;]*\)\s*(?::\s*[^{;]+)?\s*\{/, kind: 'method' },
    { re: /^\s+(?:(?:public|private|protected|readonly|static|declare)\s+)+([A-Za-z_$][\w$]*)\s*[?!]?\s*[:=]/, kind: 'property' },
  ],

  python: [
    { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/, kind: 'function', methodInContainer: true },
    { re: /^([A-Z_][A-Z0-9_]*)\s*(?::[^=]+)?=/, kind: 'constant' },
    { re: /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/, kind: 'variable' },
  ],

  go: [
    { re: /^func\s+\([^)]*\)\s*([A-Za-z_]\w*)/, kind: 'method' },
    { re: /^func\s+([A-Za-z_]\w*)/, kind: 'function' },
    { re: /^type\s+([A-Za-z_]\w*)\s+struct/, kind: 'struct', opensContainer: true },
    { re: /^type\s+([A-Za-z_]\w*)\s+interface/, kind: 'interface', opensContainer: true },
    { re: /^type\s+([A-Za-z_]\w*)/, kind: 'type' },
    { re: /^const\s+([A-Za-z_]\w*)/, kind: 'constant' },
    { re: /^var\s+([A-Za-z_]\w*)/, kind: 'variable' },
    { re: /^\s+([A-Za-z_]\w*)\s+[\w*\[\]./]+(?:\s+`[^`]*`)?\s*$/, kind: 'field' },
  ],

  rust: [
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_]\w*)/, kind: 'function', methodInContainer: true },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+([A-Za-z_]\w*)/, kind: 'struct', opensContainer: true },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?enum\s+([A-Za-z_]\w*)/, kind: 'enum', opensContainer: true },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?trait\s+([A-Za-z_]\w*)/, kind: 'trait', opensContainer: true },
    { re: /^\s*impl(?:<[^>]*>)?\s+(?:[\w:<>, ]+\s+for\s+)?([A-Za-z_]\w*)/, kind: 'module', opensContainer: true },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z_]\w*)/, kind: 'module', opensContainer: true },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?type\s+([A-Za-z_]\w*)/, kind: 'type' },
    { re: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:static|const)\s+(?:mut\s+)?([A-Za-z_]\w*)/, kind: 'constant' },
    { re: /^\s*macro_rules!\s*([A-Za-z_]\w*)/, kind: 'macro' },
  ],

  java: [
    { re: /^\s*(?:(?:public|private|protected|static|final|abstract|sealed)\s+)*(?:class|record)\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|static|abstract|sealed)\s+)*interface\s+([A-Za-z_]\w*)/, kind: 'interface', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|static|final)\s+)*enum\s+([A-Za-z_]\w*)/, kind: 'enum', opensContainer: true },
    { re: /^\s*package\s+([\w.]+)/, kind: 'module' },
    { re: /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default|strictfp)\s+)+(?:<[^>]+>\s*)?[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:throws\s+[\w., ]+)?\s*[{;]/, kind: 'method' },
    { re: /^\s*(?:(?:public|private|protected|static|final|volatile|transient)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*[=;]/, kind: 'field' },
  ],

  kotlin: [
    { re: /^\s*(?:(?:public|private|protected|internal|open|abstract|sealed|data|inner|value)\s+)*(?:class|object)\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|internal)\s+)*interface\s+([A-Za-z_]\w*)/, kind: 'interface', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|internal|open|override|suspend|inline|operator|tailrec)\s+)*fun\s+(?:<[^>]*>\s*)?(?:[\w.<>]+\.)?([A-Za-z_]\w*)/, kind: 'function', methodInContainer: true },
    { re: /^\s*(?:(?:public|private|protected|internal|const|lateinit|override)\s+)*va[lr]\s+([A-Za-z_]\w*)/, kind: 'variable' },
    { re: /^\s*typealias\s+([A-Za-z_]\w*)/, kind: 'type' },
  ],

  scala: [
    { re: /^\s*(?:(?:private|protected|final|sealed|abstract|implicit|case)\s+)*(?:class|object|trait)\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:(?:private|protected|final|override|implicit)\s+)*def\s+([A-Za-z_]\w*)/, kind: 'function', methodInContainer: true },
    { re: /^\s*(?:(?:private|protected|final|lazy|implicit)\s+)*va[lr]\s+([A-Za-z_]\w*)/, kind: 'variable' },
    { re: /^\s*type\s+([A-Za-z_]\w*)/, kind: 'type' },
  ],

  groovy: [
    { re: /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*class\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|static|final)\s+)*def\s+([A-Za-z_]\w*)/, kind: 'function', methodInContainer: true },
  ],

  swift: [
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open|final|@\w+)\s+)*(?:class|struct|actor)\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open)\s+)*protocol\s+([A-Za-z_]\w*)/, kind: 'interface', opensContainer: true },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|indirect)\s+)*enum\s+([A-Za-z_]\w*)/, kind: 'enum', opensContainer: true },
    { re: /^\s*extension\s+([A-Za-z_]\w*)/, kind: 'module', opensContainer: true },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|open|static|class|override|mutating|@\w+)\s+)*func\s+([A-Za-z_]\w*)/, kind: 'function', methodInContainer: true },
    { re: /^\s*(?:(?:public|private|internal|fileprivate|static|lazy|weak|@\w+)\s+)*(?:let|var)\s+([A-Za-z_]\w*)/, kind: 'variable' },
    { re: /^\s*typealias\s+([A-Za-z_]\w*)/, kind: 'type' },
  ],

  c: [
    { re: /^\s*(?:typedef\s+)?struct\s+([A-Za-z_]\w*)/, kind: 'struct', opensContainer: true },
    { re: /^\s*(?:typedef\s+)?union\s+([A-Za-z_]\w*)/, kind: 'struct' },
    { re: /^\s*(?:typedef\s+)?enum\s+([A-Za-z_]\w*)/, kind: 'enum' },
    { re: /^\s*#\s*define\s+([A-Za-z_]\w*)/, kind: 'macro' },
    { re: /^\s*typedef\s+.*\b([A-Za-z_]\w*)\s*;/, kind: 'type' },
    { re: /^\s*[A-Za-z_][\w\s*&:<>,]*?\b([A-Za-z_]\w*)\s*\([^;]*\)\s*(?:const\s*)?\{/, kind: 'function', methodInContainer: true },
  ],

  cpp: [
    { re: /^\s*(?:template\s*<[^>]*>\s*)?class\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:template\s*<[^>]*>\s*)?struct\s+([A-Za-z_]\w*)/, kind: 'struct', opensContainer: true },
    { re: /^\s*enum(?:\s+class)?\s+([A-Za-z_]\w*)/, kind: 'enum' },
    { re: /^\s*namespace\s+([A-Za-z_]\w*)/, kind: 'module', opensContainer: true },
    { re: /^\s*#\s*define\s+([A-Za-z_]\w*)/, kind: 'macro' },
    { re: /^\s*using\s+([A-Za-z_]\w*)\s*=/, kind: 'type' },
    { re: /^\s*[A-Za-z_~][\w\s*&:<>,]*?\b([A-Za-z_~]\w*)\s*\([^;]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{/, kind: 'function', methodInContainer: true },
  ],

  'objective-c': [
    { re: /^\s*@(?:interface|implementation)\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*@protocol\s+([A-Za-z_]\w*)/, kind: 'interface', opensContainer: true },
    { re: /^\s*[-+]\s*\([^)]*\)\s*([A-Za-z_]\w*)/, kind: 'method' },
    { re: /^\s*#\s*define\s+([A-Za-z_]\w*)/, kind: 'macro' },
  ],

  csharp: [
    { re: /^\s*(?:(?:public|private|protected|internal|static|sealed|abstract|partial|record)\s+)*class\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|internal)\s+)*interface\s+([A-Za-z_]\w*)/, kind: 'interface', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|internal)\s+)*(?:struct|record)\s+([A-Za-z_]\w*)/, kind: 'struct', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|internal)\s+)*enum\s+([A-Za-z_]\w*)/, kind: 'enum' },
    { re: /^\s*namespace\s+([\w.]+)/, kind: 'module' },
    { re: /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|extern|new)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\([^)]*\)/, kind: 'method' },
    { re: /^\s*(?:(?:public|private|protected|internal|static|readonly|const|virtual|override)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*\{\s*get/, kind: 'property' },
    { re: /^\s*(?:(?:public|private|protected|internal|static|readonly|const)\s+)+[\w.<>\[\],? ]+\s+([A-Za-z_]\w*)\s*[=;]/, kind: 'field' },
  ],

  ruby: [
    { re: /^\s*(?:class|module)\s+([A-Z][\w:]*)/, kind: 'class', opensContainer: true },
    { re: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!=]?)/, kind: 'function', methodInContainer: true },
    { re: /^\s*attr_(?:accessor|reader|writer)\s+:([A-Za-z_]\w*)/, kind: 'property' },
    { re: /^\s*([A-Z][A-Z0-9_]*)\s*=/, kind: 'constant' },
  ],

  php: [
    { re: /^\s*(?:(?:abstract|final)\s+)*class\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:interface|trait|enum)\s+([A-Za-z_]\w*)/, kind: 'interface', opensContainer: true },
    { re: /^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_]\w*)/, kind: 'function', methodInContainer: true },
    { re: /^\s*const\s+([A-Za-z_]\w*)/, kind: 'constant' },
    { re: /^\s*define\s*\(\s*['"]([A-Za-z_]\w*)/, kind: 'constant' },
    { re: /^\s*(?:public|private|protected|static|var)\s+\$([A-Za-z_]\w*)/, kind: 'property' },
    { re: /^\s*namespace\s+([\w\\]+)/, kind: 'module' },
  ],

  dart: [
    { re: /^\s*(?:abstract\s+)?class\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*(?:mixin|extension|enum)\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*typedef\s+([A-Za-z_]\w*)/, kind: 'type' },
    { re: /^\s*(?:(?:static|final|const|late)\s+)*[\w<>,\[\]? ]+\s+([A-Za-z_]\w*)\s*\([^)]*\)\s*(?:async\s*\*?\s*)?\{/, kind: 'function', methodInContainer: true },
  ],

  elixir: [
    { re: /^\s*defmodule\s+([A-Z][\w.]*)/, kind: 'module', opensContainer: true },
    { re: /^\s*defp?\s+([a-z_]\w*[?!]?)/, kind: 'function', methodInContainer: true },
    { re: /^\s*defmacro p?\s*([a-z_]\w*)/, kind: 'macro' },
    { re: /^\s*defstruct\b/, kind: 'struct' },
  ],

  erlang: [
    { re: /^\s*-module\(([a-z_]\w*)\)/, kind: 'module' },
    { re: /^([a-z_]\w*)\s*\(/, kind: 'function' },
  ],

  haskell: [
    { re: /^([a-z_][\w']*)\s*::/, kind: 'function' },
    { re: /^\s*(?:data|newtype|type)\s+([A-Z][\w']*)/, kind: 'type' },
    { re: /^\s*class\s+([A-Z][\w']*)/, kind: 'class' },
  ],

  clojure: [
    { re: /^\s*\(def(?:n|n-|macro|protocol|record|struct)?\s+([^\s()]+)/, kind: 'function' },
    { re: /^\s*\(ns\s+([^\s()]+)/, kind: 'module' },
  ],

  lua: [
    { re: /^\s*(?:local\s+)?function\s+([\w.:]+)/, kind: 'function' },
    { re: /^\s*(?:local\s+)?([\w.]+)\s*=\s*function/, kind: 'function' },
    { re: /^\s*local\s+([A-Za-z_]\w*)\s*=/, kind: 'variable' },
  ],

  r: [
    { re: /^\s*([A-Za-z_.][\w.]*)\s*(?:<-|=)\s*function/, kind: 'function' },
    { re: /^\s*([A-Za-z_.][\w.]*)\s*<-/, kind: 'variable' },
  ],

  julia: [
    { re: /^\s*function\s+([A-Za-z_]\w*)/, kind: 'function' },
    { re: /^\s*(?:mutable\s+)?struct\s+([A-Za-z_]\w*)/, kind: 'struct', opensContainer: true },
    { re: /^\s*macro\s+([A-Za-z_]\w*)/, kind: 'macro' },
    { re: /^\s*module\s+([A-Za-z_]\w*)/, kind: 'module', opensContainer: true },
    { re: /^\s*([A-Za-z_]\w*)\s*\([^)]*\)\s*=\s*/, kind: 'function' },
  ],

  perl: [
    { re: /^\s*sub\s+([A-Za-z_]\w*)/, kind: 'function' },
    { re: /^\s*package\s+([\w:]+)/, kind: 'module', opensContainer: true },
  ],

  shell: [
    { re: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{/, kind: 'function' },
    { re: /^\s*function\s+([A-Za-z_]\w*)/, kind: 'function' },
    { re: /^\s*(?:export\s+|readonly\s+)?([A-Z_][A-Z0-9_]*)=/, kind: 'constant' },
  ],

  powershell: [
    { re: /^\s*function\s+([\w-]+)/, kind: 'function' },
    { re: /^\s*class\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
  ],

  sql: [
    { re: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([\w.]+)/i, kind: 'struct' },
    { re: /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+[`"[]?([\w.]+)/i, kind: 'function' },
    { re: /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?([\w.]+)/i, kind: 'property' },
    { re: /^\s*CREATE\s+TYPE\s+[`"[]?([\w.]+)/i, kind: 'type' },
  ],

  graphql: [
    { re: /^\s*(?:type|input|interface|enum|union|scalar)\s+([A-Za-z_]\w*)/, kind: 'type', opensContainer: true },
    { re: /^\s*fragment\s+([A-Za-z_]\w*)/, kind: 'type' },
    { re: /^\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:/, kind: 'field' },
  ],

  proto: [
    { re: /^\s*message\s+([A-Za-z_]\w*)/, kind: 'struct', opensContainer: true },
    { re: /^\s*service\s+([A-Za-z_]\w*)/, kind: 'interface', opensContainer: true },
    { re: /^\s*enum\s+([A-Za-z_]\w*)/, kind: 'enum' },
    { re: /^\s*rpc\s+([A-Za-z_]\w*)/, kind: 'method' },
  ],

  hcl: [
    { re: /^\s*(?:resource|data)\s+"[^"]+"\s+"([^"]+)"/, kind: 'struct' },
    { re: /^\s*(?:variable|output|module|provider)\s+"([^"]+)"/, kind: 'variable' },
    { re: /^\s*([A-Za-z_][\w-]*)\s*=/, kind: 'field' },
  ],

  css: [
    { re: /^\s*\.([\w-]+)/, kind: 'selector' },
    { re: /^\s*#([\w-]+)/, kind: 'selector' },
    { re: /^\s*--([\w-]+)\s*:/, kind: 'variable' },
  ],

  scss: [
    { re: /^\s*@mixin\s+([\w-]+)/, kind: 'function' },
    { re: /^\s*@function\s+([\w-]+)/, kind: 'function' },
    { re: /^\s*\$([\w-]+)\s*:/, kind: 'variable' },
    { re: /^\s*\.([\w-]+)/, kind: 'selector' },
    { re: /^\s*#([\w-]+)/, kind: 'selector' },
    { re: /^\s*--([\w-]+)\s*:/, kind: 'variable' },
  ],

  sol: [
    { re: /^\s*(?:contract|library|interface)\s+([A-Za-z_]\w*)/, kind: 'class', opensContainer: true },
    { re: /^\s*function\s+([A-Za-z_]\w*)/, kind: 'function', methodInContainer: true },
    { re: /^\s*(?:struct|enum|event|modifier|error)\s+([A-Za-z_]\w*)/, kind: 'struct' },
  ],

  vb: [
    { re: /^\s*(?:(?:Public|Private|Protected|Friend|Shared|Overrides)\s+)*(?:Sub|Function)\s+([A-Za-z_]\w*)/i, kind: 'function', methodInContainer: true },
    { re: /^\s*(?:(?:Public|Private|Protected|Friend)\s+)*(?:Class|Module|Structure|Interface)\s+([A-Za-z_]\w*)/i, kind: 'class', opensContainer: true },
    { re: /^\s*(?:(?:Public|Private|Protected|Friend)\s+)*Property\s+([A-Za-z_]\w*)/i, kind: 'property' },
  ],

  fsharp: [
    { re: /^\s*let\s+(?:rec\s+|mutable\s+|inline\s+)*([A-Za-z_]\w*)/, kind: 'function' },
    { re: /^\s*type\s+([A-Za-z_]\w*)/, kind: 'type', opensContainer: true },
    { re: /^\s*module\s+([A-Za-z_]\w*)/, kind: 'module', opensContainer: true },
  ],

  pascal: [
    { re: /^\s*(?:procedure|function)\s+([A-Za-z_]\w*)/i, kind: 'function' },
    { re: /^\s*type\s+([A-Za-z_]\w*)/i, kind: 'type' },
  ],
}

// Aliases: these share a grammar family with an entry above.
RULES.javascript = RULES.typescript
RULES.html = RULES.typescript
RULES.less = RULES.scss

/** Used for languages with no dedicated table, so nothing is completely opaque. */
export const GENERIC_RULES: DeclarationRule[] = [
  { re: new RegExp(`^\\s*(?:def|func|function|fn|sub|proc|method)\\s+(${ID})`), kind: 'function' },
  { re: new RegExp(`^\\s*(?:class|struct|interface|type|module|enum|trait)\\s+(${ID})`), kind: 'class' },
  { re: new RegExp(`^\\s*(?:const|let|var|val)\\s+(${ID})`), kind: 'variable' },
]

export function rulesFor(language: string): DeclarationRule[] {
  return RULES[language] ?? GENERIC_RULES
}

/**
 * Languages whose nesting is not expressed with braces — either significant
 * indentation (Python) or keyword terminators like `end` (Ruby, Elixir). Both
 * are conventionally indented, so indentation is the reliable scope signal.
 */
export const INDENT_SCOPED = new Set([
  'python',
  'yaml',
  'haskell',
  'ruby',
  'elixir',
  'julia',
  'lua',
  'vb',
  'pascal',
  'fsharp',
])

/** Single-line comment prefixes, used to classify references. */
export const COMMENT_PREFIXES: Record<string, string[]> = {
  typescript: ['//', '/*', '*'],
  javascript: ['//', '/*', '*'],
  java: ['//', '/*', '*'],
  kotlin: ['//', '/*', '*'],
  scala: ['//', '/*', '*'],
  groovy: ['//', '/*', '*'],
  swift: ['//', '/*', '*'],
  c: ['//', '/*', '*'],
  cpp: ['//', '/*', '*'],
  'objective-c': ['//', '/*', '*'],
  csharp: ['//', '/*', '*'],
  go: ['//', '/*', '*'],
  rust: ['//', '///', '/*', '*'],
  php: ['//', '#', '/*', '*'],
  dart: ['//', '/*', '*'],
  sol: ['//', '/*', '*'],
  css: ['/*', '*'],
  scss: ['//', '/*', '*'],
  less: ['//', '/*', '*'],
  python: ['#'],
  ruby: ['#'],
  shell: ['#'],
  perl: ['#'],
  r: ['#'],
  julia: ['#'],
  elixir: ['#'],
  yaml: ['#'],
  hcl: ['#', '//'],
  proto: ['//'],
  graphql: ['#'],
  sql: ['--'],
  lua: ['--'],
  haskell: ['--'],
  clojure: [';'],
  vb: ["'"],
  powershell: ['#'],
}
