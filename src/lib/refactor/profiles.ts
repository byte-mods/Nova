/**
 * Per-language facts the engine needs in order to *write* code, as opposed to
 * the read-only patterns in `electron/lib/declarations.ts`.
 *
 * Synthesis needs more than a declaration regex: how a binding is spelled, what
 * terminates a statement, whether a type is mandatory, what the instance
 * receiver is called. Languages without a profile still get navigation and Safe
 * Delete (which only removes text), but the extract/inline family refuses
 * rather than guessing — a wrong guess writes broken code into the user's file.
 */

export interface FunctionShape {
  name: string
  params: string[]
  /** Rendered when the language wants one and the caller could infer it. */
  returnType?: string
  isMethod: boolean
  isStatic: boolean
  visibility?: 'public' | 'private' | 'protected' | ''
}

export interface LanguageProfile {
  id: string
  /** Appended to synthesized statements. */
  terminator: string
  /** One indentation step. Overridden by whatever the file already uses. */
  indent: string
  lineComments: string[]
  blockComments: [string, string][]
  /** Quote characters that open a string literal. */
  quotes: string[]
  /** Python/Scala style `"""…"""`. */
  tripleQuotes: boolean
  /** Backtick strings that ignore backslash escapes (Go, shell). */
  rawBacktick: boolean
  indentScoped: boolean
  /** A local binding needs an explicit type the engine cannot infer. */
  typedLocals: boolean
  typedFields: boolean
  typedParams: boolean
  /** `this.` / `self.` / '' — prefixed onto extracted fields and methods. */
  receiver: string
  /** Parameter the language makes explicit on methods (`self` in Python). */
  implicitSelfParam: string | null
  /** Used when a type is mandatory and inference found nothing. */
  fallbackType: string
  keywords: Set<string>

  local(name: string, expr: string, type?: string): string
  constant(name: string, expr: string, type?: string): string
  field(name: string, expr: string | null, type: string | undefined, isStatic: boolean): string
  functionHeader(shape: FunctionShape): string
  /** Closing line for brace languages, `null` where indentation closes the block. */
  functionFooter(): string | null
  returnStatement(expr: string): string
  param(name: string, type?: string, initializer?: string): string
  /** True when a trailing parameter may carry a default, so call sites can stay. */
  supportsDefaultParams: boolean
  /** Renders the container introduced by Introduce Parameter Object. */
  parameterObject(name: string, fields: { name: string; type?: string }[]): string[]
  /** Reads a field off the parameter object inside the body. */
  parameterObjectAccess(objectName: string, field: string): string
  /** Builds the object at a call site. */
  parameterObjectLiteral(typeName: string, entries: { name: string; value: string }[]): string
}

const C_KEYWORDS = [
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
  'return', 'new', 'delete', 'typeof', 'instanceof', 'in', 'of', 'this', 'super', 'null',
  'true', 'false', 'undefined', 'void', 'try', 'catch', 'finally', 'throw', 'class',
  'function', 'const', 'let', 'var', 'static', 'public', 'private', 'protected', 'import',
  'export', 'from', 'as', 'async', 'await', 'yield', 'extends', 'implements', 'interface',
  'enum', 'type', 'namespace', 'declare', 'readonly', 'abstract', 'override', 'get', 'set',
]

function braceFooter() {
  return '}'
}

/* ---------------- TypeScript / JavaScript ---------------- */

const typescript: LanguageProfile = {
  id: 'typescript',
  terminator: '',
  indent: '  ',
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  quotes: ["'", '"', '`'],
  tripleQuotes: false,
  rawBacktick: false,
  indentScoped: false,
  typedLocals: false,
  typedFields: false,
  typedParams: false,
  receiver: 'this.',
  implicitSelfParam: null,
  fallbackType: 'unknown',
  keywords: new Set(C_KEYWORDS),
  local: (name, expr, type) => `const ${name}${type ? `: ${type}` : ''} = ${expr}`,
  constant: (name, expr, type) => `const ${name}${type ? `: ${type}` : ''} = ${expr}`,
  field: (name, expr, type, isStatic) =>
    `${isStatic ? 'static ' : ''}private readonly ${name}${type ? `: ${type}` : ''}${expr ? ` = ${expr}` : ''}`,
  functionHeader: (s) =>
    s.isMethod
      ? `${s.visibility && s.visibility !== 'public' ? `${s.visibility} ` : ''}${s.isStatic ? 'static ' : ''}${s.name}(${s.params.join(', ')})${s.returnType ? `: ${s.returnType}` : ''} {`
      : `function ${s.name}(${s.params.join(', ')})${s.returnType ? `: ${s.returnType}` : ''} {`,
  functionFooter: braceFooter,
  returnStatement: (expr) => `return ${expr}`,
  param: (name, type, initializer) =>
    `${name}${type ? `: ${type}` : ''}${initializer ? ` = ${initializer}` : ''}`,
  supportsDefaultParams: true,
  parameterObject: (name, fields) => [
    `interface ${name} {`,
    ...fields.map((f) => `  ${f.name}: ${f.type ?? 'unknown'}`),
    '}',
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
  parameterObjectLiteral: (_type, entries) =>
    `{ ${entries.map((e) => (e.name === e.value ? e.name : `${e.name}: ${e.value}`)).join(', ')} }`,
}

const javascript: LanguageProfile = {
  ...typescript,
  id: 'javascript',
  fallbackType: '',
  local: (name, expr) => `const ${name} = ${expr}`,
  constant: (name, expr) => `const ${name} = ${expr}`,
  field: (name, expr, _type, isStatic) =>
    `${isStatic ? 'static ' : ''}${name}${expr ? ` = ${expr}` : ''}`,
  functionHeader: (s) =>
    s.isMethod
      ? `${s.isStatic ? 'static ' : ''}${s.name}(${s.params.join(', ')}) {`
      : `function ${s.name}(${s.params.join(', ')}) {`,
  param: (name, _type, initializer) => `${name}${initializer ? ` = ${initializer}` : ''}`,
  parameterObject: (name, fields) => [
    `/** @typedef {{ ${fields.map((f) => `${f.name}: *`).join(', ')} }} ${name} */`,
  ],
}

/* ---------------- Python ---------------- */

const python: LanguageProfile = {
  id: 'python',
  terminator: '',
  indent: '    ',
  lineComments: ['#'],
  blockComments: [],
  quotes: ["'", '"'],
  tripleQuotes: true,
  rawBacktick: false,
  indentScoped: true,
  typedLocals: false,
  typedFields: false,
  typedParams: false,
  receiver: 'self.',
  implicitSelfParam: 'self',
  fallbackType: '',
  keywords: new Set([
    'if', 'elif', 'else', 'for', 'while', 'return', 'def', 'class', 'import', 'from', 'as',
    'in', 'is', 'not', 'and', 'or', 'None', 'True', 'False', 'try', 'except', 'finally',
    'raise', 'with', 'lambda', 'pass', 'break', 'continue', 'yield', 'global', 'nonlocal',
    'assert', 'del', 'async', 'await', 'self', 'cls',
  ]),
  local: (name, expr) => `${name} = ${expr}`,
  constant: (name, expr) => `${name} = ${expr}`,
  field: (name, expr) => `${name} = ${expr ?? 'None'}`,
  functionHeader: (s) => `def ${s.name}(${s.params.join(', ')})${s.returnType ? ` -> ${s.returnType}` : ''}:`,
  functionFooter: () => null,
  returnStatement: (expr) => `return ${expr}`,
  param: (name, type, initializer) =>
    `${name}${type ? `: ${type}` : ''}${initializer ? `${type ? ' = ' : '='}${initializer}` : ''}`,
  supportsDefaultParams: true,
  parameterObject: (name, fields) => [
    '@dataclass',
    `class ${name}:`,
    ...fields.map((f) => `    ${f.name}: ${f.type || 'Any'}`),
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
  parameterObjectLiteral: (type, entries) =>
    `${type}(${entries.map((e) => `${e.name}=${e.value}`).join(', ')})`,
}

/* ---------------- Go ---------------- */

const go: LanguageProfile = {
  id: 'go',
  terminator: '',
  indent: '\t',
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  quotes: ["'", '"'],
  tripleQuotes: false,
  rawBacktick: true,
  indentScoped: false,
  typedLocals: false,
  typedFields: true,
  typedParams: true,
  receiver: '',
  implicitSelfParam: null,
  fallbackType: 'interface{}',
  keywords: new Set([
    'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'return',
    'func', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer',
    'select', 'package', 'import', 'nil', 'true', 'false', 'make', 'new', 'len', 'cap',
    'append', 'string', 'int', 'int64', 'float64', 'bool', 'byte', 'rune', 'error',
  ]),
  local: (name, expr) => `${name} := ${expr}`,
  constant: (name, expr) => `const ${name} = ${expr}`,
  field: (name, _expr, type) => `${name} ${type || 'interface{}'}`,
  functionHeader: (s) =>
    `func ${s.name}(${s.params.join(', ')})${s.returnType ? ` ${s.returnType}` : ''} {`,
  functionFooter: braceFooter,
  returnStatement: (expr) => `return ${expr}`,
  param: (name, type) => `${name} ${type || 'interface{}'}`,
  supportsDefaultParams: false,
  parameterObject: (name, fields) => [
    `type ${name} struct {`,
    ...fields.map((f) => `\t${f.name} ${f.type || 'interface{}'}`),
    '}',
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
  parameterObjectLiteral: (type, entries) =>
    `${type}{${entries.map((e) => `${e.name}: ${e.value}`).join(', ')}}`,
}

/* ---------------- Java / Kotlin / C# ---------------- */

const java: LanguageProfile = {
  id: 'java',
  terminator: ';',
  indent: '    ',
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  quotes: ["'", '"'],
  tripleQuotes: false,
  rawBacktick: false,
  indentScoped: false,
  typedLocals: false,
  typedFields: true,
  typedParams: true,
  receiver: 'this.',
  implicitSelfParam: null,
  fallbackType: 'Object',
  keywords: new Set([
    ...C_KEYWORDS, 'final', 'synchronized', 'volatile', 'transient', 'package', 'int', 'long',
    'double', 'float', 'boolean', 'char', 'byte', 'short', 'String', 'var', 'record',
  ]),
  local: (name, expr, type) => `${type || 'var'} ${name} = ${expr};`,
  constant: (name, expr, type) => `private static final ${type || 'Object'} ${name} = ${expr};`,
  field: (name, expr, type, isStatic) =>
    `private ${isStatic ? 'static ' : ''}final ${type || 'Object'} ${name}${expr ? ` = ${expr}` : ''};`,
  functionHeader: (s) =>
    `${s.visibility || 'private'} ${s.isStatic ? 'static ' : ''}${s.returnType || 'void'} ${s.name}(${s.params.join(', ')}) {`,
  functionFooter: braceFooter,
  returnStatement: (expr) => `return ${expr};`,
  param: (name, type) => `${type || 'Object'} ${name}`,
  supportsDefaultParams: false,
  parameterObject: (name, fields) => [
    `record ${name}(${fields.map((f) => `${f.type || 'Object'} ${f.name}`).join(', ')}) {}`,
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}()`,
  parameterObjectLiteral: (type, entries) => `new ${type}(${entries.map((e) => e.value).join(', ')})`,
}

const kotlin: LanguageProfile = {
  ...java,
  id: 'kotlin',
  terminator: '',
  typedLocals: false,
  fallbackType: 'Any',
  local: (name, expr, type) => `val ${name}${type ? `: ${type}` : ''} = ${expr}`,
  constant: (name, expr, type) => `private val ${name}${type ? `: ${type}` : ''} = ${expr}`,
  field: (name, expr, type, _isStatic) =>
    `private val ${name}${type ? `: ${type}` : ''}${expr ? ` = ${expr}` : ''}`,
  functionHeader: (s) =>
    `${s.visibility && s.visibility !== 'public' ? `${s.visibility} ` : ''}fun ${s.name}(${s.params.join(', ')})${s.returnType ? `: ${s.returnType}` : ''} {`,
  returnStatement: (expr) => `return ${expr}`,
  param: (name, type, initializer) =>
    `${name}: ${type || 'Any'}${initializer ? ` = ${initializer}` : ''}`,
  supportsDefaultParams: true,
  parameterObject: (name, fields) => [
    `data class ${name}(${fields.map((f) => `val ${f.name}: ${f.type || 'Any'}`).join(', ')})`,
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
  parameterObjectLiteral: (type, entries) =>
    `${type}(${entries.map((e) => `${e.name} = ${e.value}`).join(', ')})`,
}

const csharp: LanguageProfile = {
  ...java,
  id: 'csharp',
  fallbackType: 'object',
  keywords: new Set([...C_KEYWORDS, 'namespace', 'using', 'internal', 'sealed', 'partial', 'record', 'string', 'int', 'bool', 'double', 'decimal', 'object', 'var']),
  local: (name, expr, type) => `${type || 'var'} ${name} = ${expr};`,
  constant: (name, expr, type) => `private const ${type || 'object'} ${name} = ${expr};`,
  field: (name, expr, type, isStatic) =>
    `private ${isStatic ? 'static ' : ''}readonly ${type || 'object'} ${name}${expr ? ` = ${expr}` : ''};`,
  parameterObject: (name, fields) => [
    `public sealed record ${name}(${fields.map((f) => `${f.type || 'object'} ${f.name}`).join(', ')});`,
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
}

/* ---------------- Rust ---------------- */

const rust: LanguageProfile = {
  id: 'rust',
  terminator: ';',
  indent: '    ',
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  quotes: ["'", '"'],
  tripleQuotes: false,
  rawBacktick: false,
  indentScoped: false,
  typedLocals: false,
  typedFields: true,
  typedParams: true,
  receiver: 'self.',
  implicitSelfParam: '&self',
  fallbackType: '()',
  keywords: new Set([
    'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait', 'impl', 'for', 'while',
    'loop', 'if', 'else', 'match', 'return', 'use', 'mod', 'pub', 'crate', 'self', 'super',
    'true', 'false', 'move', 'ref', 'where', 'as', 'dyn', 'async', 'await', 'unsafe', 'type',
  ]),
  local: (name, expr, type) => `let ${name}${type ? `: ${type}` : ''} = ${expr};`,
  constant: (name, expr, type) => `const ${name}: ${type || 'i64'} = ${expr};`,
  field: (name, _expr, type) => `${name}: ${type || '()'},`,
  functionHeader: (s) =>
    `${s.visibility === 'public' ? 'pub ' : ''}fn ${s.name}(${s.params.join(', ')})${s.returnType ? ` -> ${s.returnType}` : ''} {`,
  functionFooter: braceFooter,
  returnStatement: (expr) => expr,
  param: (name, type) => `${name}: ${type || '()'}`,
  supportsDefaultParams: false,
  parameterObject: (name, fields) => [
    `pub struct ${name} {`,
    ...fields.map((f) => `    pub ${f.name}: ${f.type || '()'},`),
    '}',
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
  parameterObjectLiteral: (type, entries) =>
    `${type} { ${entries.map((e) => `${e.name}: ${e.value}`).join(', ')} }`,
}

/* ---------------- C / C++ ---------------- */

const c: LanguageProfile = {
  id: 'c',
  terminator: ';',
  indent: '    ',
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  quotes: ["'", '"'],
  tripleQuotes: false,
  rawBacktick: false,
  indentScoped: false,
  typedLocals: true,
  typedFields: true,
  typedParams: true,
  receiver: '',
  implicitSelfParam: null,
  fallbackType: 'int',
  keywords: new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue',
    'return', 'struct', 'union', 'enum', 'typedef', 'static', 'const', 'void', 'int', 'char',
    'float', 'double', 'long', 'short', 'unsigned', 'signed', 'sizeof', 'NULL',
  ]),
  local: (name, expr, type) => `${type || 'int'} ${name} = ${expr};`,
  constant: (name, expr, type) => `static const ${type || 'int'} ${name} = ${expr};`,
  field: (name, _expr, type) => `${type || 'int'} ${name};`,
  functionHeader: (s) => `static ${s.returnType || 'void'} ${s.name}(${s.params.join(', ') || 'void'}) {`,
  functionFooter: braceFooter,
  returnStatement: (expr) => `return ${expr};`,
  param: (name, type) => `${type || 'int'} ${name}`,
  supportsDefaultParams: false,
  parameterObject: (name, fields) => [
    `typedef struct {`,
    ...fields.map((f) => `    ${f.type || 'int'} ${f.name};`),
    `} ${name};`,
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
  parameterObjectLiteral: (type, entries) =>
    `(${type}){ ${entries.map((e) => `.${e.name} = ${e.value}`).join(', ')} }`,
}

const cpp: LanguageProfile = {
  ...c,
  id: 'cpp',
  typedLocals: false,
  fallbackType: 'auto',
  receiver: 'this->',
  keywords: new Set([...C_KEYWORDS, 'nullptr', 'namespace', 'template', 'typename', 'auto', 'using', 'operator', 'virtual', 'explicit', 'friend', 'constexpr']),
  local: (name, expr, type) => `${type || 'auto'} ${name} = ${expr};`,
  constant: (name, expr, type) => `static constexpr ${type || 'auto'} ${name} = ${expr};`,
  functionHeader: (s) =>
    s.isMethod
      ? `${s.isStatic ? 'static ' : ''}${s.returnType || 'void'} ${s.name}(${s.params.join(', ')}) {`
      : `static ${s.returnType || 'void'} ${s.name}(${s.params.join(', ')}) {`,
  supportsDefaultParams: true,
  param: (name, type, initializer) =>
    `${type || 'auto'} ${name}${initializer ? ` = ${initializer}` : ''}`,
}

/* ---------------- Swift / Ruby / PHP / Dart / Scala ---------------- */

const swift: LanguageProfile = {
  id: 'swift',
  terminator: '',
  indent: '    ',
  lineComments: ['//'],
  blockComments: [['/*', '*/']],
  quotes: ['"'],
  tripleQuotes: true,
  rawBacktick: false,
  indentScoped: false,
  typedLocals: false,
  typedFields: false,
  typedParams: true,
  receiver: 'self.',
  implicitSelfParam: null,
  fallbackType: 'Any',
  keywords: new Set([...C_KEYWORDS, 'func', 'guard', 'defer', 'struct', 'protocol', 'extension', 'nil', 'self', 'init', 'deinit', 'mutating', 'inout', 'where', 'some']),
  local: (name, expr, type) => `let ${name}${type ? `: ${type}` : ''} = ${expr}`,
  constant: (name, expr, type) => `private static let ${name}${type ? `: ${type}` : ''} = ${expr}`,
  field: (name, expr, type, isStatic) =>
    `private ${isStatic ? 'static ' : ''}let ${name}${type ? `: ${type}` : ''}${expr ? ` = ${expr}` : ''}`,
  functionHeader: (s) =>
    `${s.visibility === 'private' ? 'private ' : ''}${s.isStatic ? 'static ' : ''}func ${s.name}(${s.params.join(', ')})${s.returnType ? ` -> ${s.returnType}` : ''} {`,
  functionFooter: braceFooter,
  returnStatement: (expr) => `return ${expr}`,
  param: (name, type, initializer) =>
    `${name}: ${type || 'Any'}${initializer ? ` = ${initializer}` : ''}`,
  supportsDefaultParams: true,
  parameterObject: (name, fields) => [
    `struct ${name} {`,
    ...fields.map((f) => `    let ${f.name}: ${f.type || 'Any'}`),
    '}',
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
  parameterObjectLiteral: (type, entries) =>
    `${type}(${entries.map((e) => `${e.name}: ${e.value}`).join(', ')})`,
}

const ruby: LanguageProfile = {
  id: 'ruby',
  terminator: '',
  indent: '  ',
  lineComments: ['#'],
  blockComments: [],
  quotes: ["'", '"'],
  tripleQuotes: false,
  rawBacktick: false,
  indentScoped: true,
  typedLocals: false,
  typedFields: false,
  typedParams: false,
  receiver: '@',
  implicitSelfParam: null,
  fallbackType: '',
  keywords: new Set([
    'def', 'end', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'while', 'until', 'do',
    'return', 'yield', 'require', 'nil', 'true', 'false', 'self', 'begin', 'rescue', 'ensure',
    'raise', 'case', 'when', 'then', 'attr_accessor', 'attr_reader', 'attr_writer', 'new',
  ]),
  local: (name, expr) => `${name} = ${expr}`,
  constant: (name, expr) => `${name} = ${expr}`,
  field: (name, expr) => `@${name} = ${expr ?? 'nil'}`,
  functionHeader: (s) => `def ${s.name}${s.params.length ? `(${s.params.join(', ')})` : ''}`,
  functionFooter: () => 'end',
  returnStatement: (expr) => expr,
  param: (name, _type, initializer) => `${name}${initializer ? ` = ${initializer}` : ''}`,
  supportsDefaultParams: true,
  parameterObject: (name, fields) => [
    `${name} = Struct.new(${fields.map((f) => `:${f.name}`).join(', ')}, keyword_init: true)`,
  ],
  parameterObjectAccess: (object, field) => `${object}.${field}`,
  parameterObjectLiteral: (type, entries) =>
    `${type}.new(${entries.map((e) => `${e.name}: ${e.value}`).join(', ')})`,
}

const php: LanguageProfile = {
  id: 'php',
  terminator: ';',
  indent: '    ',
  lineComments: ['//', '#'],
  blockComments: [['/*', '*/']],
  quotes: ["'", '"'],
  tripleQuotes: false,
  rawBacktick: false,
  indentScoped: false,
  typedLocals: false,
  typedFields: false,
  typedParams: false,
  receiver: '$this->',
  implicitSelfParam: null,
  fallbackType: 'mixed',
  keywords: new Set([...C_KEYWORDS, 'echo', 'elseif', 'foreach', 'endforeach', 'array', 'fn', 'use', 'namespace', 'trait', 'global']),
  local: (name, expr) => `$${name} = ${expr};`,
  constant: (name, expr) => `const ${name} = ${expr};`,
  field: (name, expr, type, isStatic) =>
    `private ${isStatic ? 'static ' : ''}${type ? `${type} ` : ''}$${name}${expr ? ` = ${expr}` : ''};`,
  functionHeader: (s) =>
    `${s.isMethod ? `${s.visibility || 'private'} ` : ''}${s.isStatic ? 'static ' : ''}function ${s.name}(${s.params.join(', ')})${s.returnType ? `: ${s.returnType}` : ''} {`,
  functionFooter: braceFooter,
  returnStatement: (expr) => `return ${expr};`,
  param: (name, type, initializer) =>
    `${type ? `${type} ` : ''}$${name}${initializer ? ` = ${initializer}` : ''}`,
  supportsDefaultParams: true,
  parameterObject: (name, fields) => [
    `final class ${name} {`,
    `    public function __construct(${fields.map((f) => `public readonly $${f.name}`).join(', ')}) {}`,
    '}',
  ],
  parameterObjectAccess: (object, field) => `$${object}->${field}`,
  parameterObjectLiteral: (type, entries) =>
    `new ${type}(${entries.map((e) => e.value).join(', ')})`,
}

const dart: LanguageProfile = {
  ...java,
  id: 'dart',
  fallbackType: 'dynamic',
  local: (name, expr, type) => `${type || 'final'} ${name} = ${expr};`,
  constant: (name, expr, type) => `static const ${type || 'dynamic'} ${name} = ${expr};`,
  field: (name, expr, type, isStatic) =>
    `${isStatic ? 'static ' : ''}final ${type ? `${type} ` : ''}${name}${expr ? ` = ${expr}` : ''};`,
  functionHeader: (s) => `${s.returnType || 'void'} ${s.name}(${s.params.join(', ')}) {`,
  param: (name, type) => `${type || 'dynamic'} ${name}`,
  supportsDefaultParams: true,
  parameterObject: (name, fields) => [
    `class ${name} {`,
    ...fields.map((f) => `  final ${f.type || 'dynamic'} ${f.name};`),
    `  const ${name}({${fields.map((f) => `required this.${f.name}`).join(', ')}});`,
    '}',
  ],
  parameterObjectLiteral: (type, entries) =>
    `${type}(${entries.map((e) => `${e.name}: ${e.value}`).join(', ')})`,
}

const scala: LanguageProfile = {
  ...kotlin,
  id: 'scala',
  fallbackType: 'Any',
  local: (name, expr, type) => `val ${name}${type ? `: ${type}` : ''} = ${expr}`,
  constant: (name, expr, type) => `private val ${name}${type ? `: ${type}` : ''} = ${expr}`,
  functionHeader: (s) =>
    `def ${s.name}(${s.params.join(', ')})${s.returnType ? `: ${s.returnType}` : ''} = {`,
  parameterObject: (name, fields) => [
    `case class ${name}(${fields.map((f) => `${f.name}: ${f.type || 'Any'}`).join(', ')})`,
  ],
}

export const PROFILES: Record<string, LanguageProfile> = {
  typescript,
  javascript,
  typescriptreact: { ...typescript, id: 'typescriptreact' },
  javascriptreact: { ...javascript, id: 'javascriptreact' },
  python,
  go,
  java,
  kotlin,
  csharp,
  rust,
  c,
  cpp,
  'objective-c': { ...c, id: 'objective-c', receiver: 'self.' },
  swift,
  ruby,
  php,
  dart,
  scala,
}

export function profileFor(language: string): LanguageProfile | null {
  return PROFILES[language] ?? null
}

/** Human-readable list for the "not supported here" message. */
export const SUPPORTED_LANGUAGES = Object.keys(PROFILES)
