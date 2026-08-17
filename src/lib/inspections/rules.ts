/**
 * The inspection rules.
 *
 * These are the checks a language server does not give you: not type errors,
 * but the things that compile fine and are still mistakes — a `debugger` left
 * in, a `.only` that silently disables the rest of a test suite, an empty catch
 * that swallows a failure.
 *
 * Rules are regex-over-lines rather than AST-based. That is a real limitation
 * and it is why every rule below is written to be *conservative*: a false
 * positive in an always-on inspection is far more expensive than a miss,
 * because it trains people to ignore the gutter. Where a pattern cannot be
 * matched safely without parsing, the rule skips it rather than guessing.
 */

export type InspectionSeverity = 'error' | 'warning' | 'info' | 'off'

export interface InspectionMatch {
  /** 1-based. */
  line: number
  /** 1-based, inclusive start. */
  column: number
  endColumn: number
  message: string
  /** Replacement for the matched range, when a fix is mechanical. */
  fix?: { title: string; text: string }
  /** Deletes the whole line instead of replacing a range. */
  fixDeleteLine?: { title: string }
}

export interface InspectionRule {
  id: string
  name: string
  description: string
  defaultSeverity: InspectionSeverity
  /** File extensions this applies to. Empty means every text file. */
  extensions: string[]
  run: (line: string, lineNumber: number, context: RuleContext) => InspectionMatch[]
}

export interface RuleContext {
  path: string
  /** Every line of the file, for rules that need to look around. */
  lines: string[]
}

/**
 * Strips string and comment content so a rule does not fire on the word
 * `debugger` inside a log message. Crude but predictable: quotes are replaced
 * with spaces of equal length, so column numbers still line up.
 */
function blankLiterals(line: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (quote) {
      out += char === quote && line[i - 1] !== '\\' ? char : ' '
      if (char === quote && line[i - 1] !== '\\') quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      continue
    }
    // A line comment ends the interesting part of the line.
    if (char === '/' && line[i + 1] === '/') {
      out += ' '.repeat(line.length - i)
      break
    }
    if (char === '#' && !line.slice(0, i).includes('$')) {
      // `#` starts a comment in shell/python but is a private field in JS.
      out += line[i + 1] === '{' ? char : ' '.repeat(line.length - i)
      if (line[i + 1] !== '{') break
      continue
    }
    out += char
  }
  return out
}

const JS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']

/** Builds a rule that flags every occurrence of a regex on a code line. */
function regexRule(config: {
  id: string
  name: string
  description: string
  defaultSeverity: InspectionSeverity
  extensions: string[]
  pattern: RegExp
  message: string | ((match: RegExpMatchArray) => string)
  fix?: (match: RegExpMatchArray) => { title: string; text: string } | undefined
  deleteLine?: string
}): InspectionRule {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    defaultSeverity: config.defaultSeverity,
    extensions: config.extensions,
    run(line, lineNumber) {
      const code = blankLiterals(line)
      const out: InspectionMatch[] = []
      // Rebuilt each call: a shared /g regex carries lastIndex between lines.
      const pattern = new RegExp(config.pattern.source, config.pattern.flags.includes('g') ? config.pattern.flags : `${config.pattern.flags}g`)
      let match: RegExpExecArray | null
      while ((match = pattern.exec(code))) {
        out.push({
          line: lineNumber,
          column: match.index + 1,
          endColumn: match.index + match[0].length + 1,
          message: typeof config.message === 'function' ? config.message(match) : config.message,
          fix: config.fix?.(match),
          fixDeleteLine: config.deleteLine ? { title: config.deleteLine } : undefined,
        })
        if (match[0].length === 0) pattern.lastIndex++
      }
      return out
    },
  }
}

export const RULES: InspectionRule[] = [
  regexRule({
    id: 'debugger-statement',
    name: 'Leftover `debugger`',
    description: 'A `debugger` statement halts execution in any browser with devtools open.',
    defaultSeverity: 'error',
    extensions: JS,
    pattern: /\bdebugger\b\s*;?/,
    message: '`debugger` left in the code.',
    deleteLine: 'Remove the debugger statement',
  }),

  regexRule({
    id: 'focused-test',
    name: 'Focused test',
    description:
      '`.only` silently skips every other test in the file. It passes CI while testing almost nothing.',
    defaultSeverity: 'error',
    extensions: JS,
    pattern: /\b(?:describe|it|test|context)\.only\b/,
    message: '`.only` disables every other test in this file.',
    fix: (match) => ({ title: 'Remove `.only`', text: match[0].replace('.only', '') }),
  }),

  regexRule({
    id: 'skipped-test',
    name: 'Skipped test',
    description: 'A skipped test is a test that is not protecting you.',
    defaultSeverity: 'warning',
    extensions: JS,
    pattern: /\b(?:describe|it|test|context)\.skip\b/,
    message: 'This test is skipped.',
    fix: (match) => ({ title: 'Un-skip this test', text: match[0].replace('.skip', '') }),
  }),

  regexRule({
    id: 'console-log',
    name: 'Leftover `console.log`',
    description: 'Debug logging that reached production.',
    defaultSeverity: 'info',
    extensions: JS,
    pattern: /\bconsole\.(?:log|debug|dir)\s*\(/,
    message: 'Debug logging left in the code.',
    deleteLine: 'Remove this line',
  }),

  regexRule({
    id: 'loose-equality',
    name: 'Loose equality',
    description:
      '`==` applies type coercion, so `0 == ""` and `null == undefined` are both true. Almost always a bug.',
    defaultSeverity: 'warning',
    extensions: JS,
    // Not preceded or followed by =, ! or <, > so `===`, `!==`, `<=` are safe.
    pattern: /(?<![=!<>])(!=|==)(?!=)/,
    message: 'Use `===` / `!==` rather than coercing comparison.',
    fix: (match) => ({ title: `Change to \`${match[1]}=\``, text: `${match[1]}=` }),
  }),

  regexRule({
    id: 'var-declaration',
    name: '`var` declaration',
    description: '`var` is function-scoped and hoisted, which surprises people in loops and closures.',
    defaultSeverity: 'info',
    extensions: JS,
    pattern: /\bvar\s+(?=[A-Za-z_$])/,
    message: 'Prefer `let` or `const` over `var`.',
    fix: () => ({ title: 'Change to `let`', text: 'let ' }),
  }),

  {
    id: 'empty-catch',
    name: 'Empty catch block',
    description:
      'A catch that does nothing turns a failure into silence. If ignoring is deliberate, say so in a comment.',
    defaultSeverity: 'warning',
    extensions: JS,
    run(line, lineNumber, context) {
      const code = blankLiterals(line)
      const match = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/.exec(code)
      if (match) {
        return [
          {
            line: lineNumber,
            column: match.index + 1,
            endColumn: match.index + match[0].length + 1,
            message: 'This catch block swallows the error silently.',
          },
        ]
      }
      // The multi-line form: `catch {` followed by only `}`.
      const open = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*$/.exec(code)
      if (!open) return []
      const next = context.lines[lineNumber] // lines is 0-based, so this is the next line
      if (next !== undefined && /^\s*\}\s*$/.test(next)) {
        return [
          {
            line: lineNumber,
            column: open.index + 1,
            endColumn: open.index + open[0].length + 1,
            message: 'This catch block swallows the error silently.',
          },
        ]
      }
      return []
    },
  },

  {
    id: 'hardcoded-secret',
    name: 'Possible hardcoded secret',
    description:
      'A long literal assigned to something named like a credential. Checked into git, it is compromised.',
    defaultSeverity: 'warning',
    extensions: [],
    run(line, lineNumber) {
      // Deliberately requires both a suggestive name *and* a long literal:
      // either alone produces far too many false positives to be tolerable.
      const pattern =
        /\b(api[_-]?key|apikey|secret|password|passwd|token|access[_-]?key|private[_-]?key)\b\s*[:=]\s*["'`]([^"'`\s]{16,})["'`]/i
      const match = pattern.exec(line)
      if (!match) return []
      // Placeholders and env lookups are the normal, correct pattern.
      const value = match[2]
      if (/^(x{4,}|\*{4,}|<.*>|\$\{|process\.env|your[_-]|change[_-]?me|example|placeholder)/i.test(value)) {
        return []
      }
      return [
        {
          line: lineNumber,
          column: match.index + 1,
          endColumn: match.index + match[0].length + 1,
          message: `Possible hardcoded ${match[1].toLowerCase()}. Move it to an environment variable.`,
        },
      ]
    },
  },

  {
    id: 'todo-comment',
    name: 'TODO / FIXME',
    description: 'Tracks unfinished work left in comments.',
    defaultSeverity: 'info',
    extensions: [],
    run(line, lineNumber) {
      const match = /\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)$/.exec(line)
      if (!match) return []
      // Only inside a comment; otherwise `const TODO = 1` fires.
      const before = line.slice(0, match.index)
      if (!/(\/\/|\/\*|#|\*|<!--)\s*$/.test(before) && !/(\/\/|\/\*|#|<!--)/.test(before)) return []
      return [
        {
          line: lineNumber,
          column: match.index + 1,
          endColumn: match.index + match[0].length + 1,
          message: `${match[1]}: ${match[2].trim() || '(no description)'}`,
        },
      ]
    },
  },

  regexRule({
    id: 'python-bare-except',
    name: 'Bare `except:`',
    description: 'A bare except catches KeyboardInterrupt and SystemExit too, making the process unkillable.',
    defaultSeverity: 'warning',
    extensions: ['.py'],
    pattern: /^\s*except\s*:/,
    message: 'Bare `except:` also catches KeyboardInterrupt and SystemExit.',
    fix: (match) => ({ title: 'Catch `Exception` instead', text: match[0].replace(/except\s*:/, 'except Exception:') }),
  }),

  regexRule({
    id: 'python-mutable-default',
    name: 'Mutable default argument',
    description:
      'A default `[]` or `{}` is created once and shared by every call — the classic Python footgun.',
    defaultSeverity: 'warning',
    extensions: ['.py'],
    pattern: /def\s+\w+\s*\([^)]*=\s*(?:\[\]|\{\})/,
    message: 'Mutable default argument is shared across calls. Use `None` and build it inside.',
  }),

  {
    id: 'typo',
    name: 'Typo',
    description:
      'Common misspellings in comments, strings and identifiers. A curated list rather than a dictionary — a word it flags is wrong, full stop.',
    defaultSeverity: 'info',
    extensions: [],
    run(line, lineNumber) {
      const out: InspectionMatch[] = []
      // Words are taken from the whole line — comments and strings are exactly
      // where prose typos live — plus camelCase halves of identifiers.
      const pattern = /[A-Za-z]{4,}/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(line))) {
        for (const { word, offset } of splitCamel(match[0], match.index)) {
          const correction = TYPOS[word.toLowerCase()]
          if (!correction) continue
          out.push({
            line: lineNumber,
            column: offset + 1,
            endColumn: offset + word.length + 1,
            message: `Typo: \`${word}\` → \`${matchCase(word, correction)}\``,
            fix: { title: `Change to “${matchCase(word, correction)}”`, text: matchCase(word, correction) },
          })
        }
      }
      return out
    },
  },
]

/** camelCase / PascalCase halves, with their offsets inside the line. */
function splitCamel(identifier: string, base: number): { word: string; offset: number }[] {
  const parts: { word: string; offset: number }[] = []
  let start = 0
  for (let i = 1; i <= identifier.length; i++) {
    const boundary =
      i === identifier.length ||
      (/[a-z]/.test(identifier[i - 1]) && /[A-Z]/.test(identifier[i]))
    if (!boundary) continue
    const word = identifier.slice(start, i)
    if (word.length >= 4) parts.push({ word, offset: base + start })
    start = i
  }
  return parts
}

/** Preserves the original's capitalisation on the corrected word. */
function matchCase(original: string, correction: string): string {
  if (original === original.toUpperCase()) return correction.toUpperCase()
  if (/^[A-Z]/.test(original)) return correction[0].toUpperCase() + correction.slice(1)
  return correction
}

/**
 * Misspelling -> correction. Every entry is unambiguous — no word here is ever
 * correct English or a plausible identifier in its own right.
 */
const TYPOS: Record<string, string> = {
  recieve: 'receive', recieved: 'received', reciever: 'receiver',
  seperate: 'separate', seperated: 'separated', seperator: 'separator',
  occured: 'occurred', occurence: 'occurrence', occurences: 'occurrences',
  definately: 'definitely', accross: 'across', untill: 'until',
  wich: 'which', whith: 'with', thier: 'their', teh: 'the',
  lenght: 'length', heigth: 'height', widht: 'width',
  succesful: 'successful', succesfully: 'successfully', sucess: 'success',
  adress: 'address', adresses: 'addresses',
  paramter: 'parameter', paramters: 'parameters', parmeter: 'parameter',
  arguement: 'argument', arguements: 'arguments',
  enviroment: 'environment', enviornment: 'environment',
  intialize: 'initialize', initalize: 'initialize', initilize: 'initialize',
  calender: 'calendar', febuary: 'february',
  dependancy: 'dependency', dependancies: 'dependencies',
  existance: 'existence', persistant: 'persistent', consistant: 'consistent',
  refering: 'referring', refered: 'referred',
  comparision: 'comparison', compatiblity: 'compatibility', compability: 'compatibility',
  guarentee: 'guarantee', garantee: 'guarantee',
  neccessary: 'necessary', necesary: 'necessary',
  ommitted: 'omitted', ommit: 'omit',
  overriden: 'overridden', priviledge: 'privilege', priviledges: 'privileges',
  recomend: 'recommend', recomended: 'recommended',
  usefull: 'useful', usful: 'useful',
  visiblity: 'visibility', accessability: 'accessibility',
  writen: 'written', retreive: 'retrieve', retreived: 'retrieved',
  transfered: 'transferred', cancelation: 'cancellation',
  responce: 'response', reponse: 'response', requst: 'request', reqest: 'request',
  mesage: 'message', mesages: 'messages', messsage: 'message',
  proccess: 'process', proccessing: 'processing', procesing: 'processing',
  fucntion: 'function', funciton: 'function', functino: 'function',
  retrun: 'return', reutrn: 'return', retun: 'return',
  postion: 'position', positon: 'position',
  defualt: 'default', defalt: 'default',
  udpate: 'update', udpated: 'updated', updat: 'update',
  delte: 'delete', dleete: 'delete',
  conection: 'connection', conected: 'connected', connexion: 'connection',
  attirbute: 'attribute', attriubte: 'attribute', atribute: 'attribute',
  propery: 'property', properies: 'properties', proprety: 'property',
  chidlren: 'children', childern: 'children',
  swich: 'switch', swtich: 'switch',
  heirarchy: 'hierarchy', hierachy: 'hierarchy',
  algorithim: 'algorithm', algoritm: 'algorithm',
  asynchronus: 'asynchronous', syncronous: 'synchronous',
  temperture: 'temperature', tempature: 'temperature',
  descrption: 'description', descripton: 'description', desciption: 'description',
  identifer: 'identifier', identifers: 'identifiers',
  invaild: 'invalid', vaild: 'valid', vaildate: 'validate', validaton: 'validation',
  verison: 'version', verions: 'versions',
  peice: 'piece', beleive: 'believe', acheive: 'achieve',
  maintainence: 'maintenance', maintenence: 'maintenance',
  performace: 'performance', perfomance: 'performance',
  implemention: 'implementation', implmentation: 'implementation',
  documenation: 'documentation', documentaion: 'documentation',
  configration: 'configuration', configuraton: 'configuration', confguration: 'configuration',
  authetication: 'authentication', authentification: 'authentication',
  authorizaton: 'authorization',
  registartion: 'registration', registraton: 'registration',
}

export const RULES_BY_ID = new Map(RULES.map((r) => [r.id, r]))
