/**
 * Live templates: abbreviation in, snippet out.
 *
 * Monaco already implements tab stops, placeholders and mirrored variables, so
 * this layer is deliberately thin — a registry plus a completion provider. The
 * template body is Monaco snippet syntax (`$1`, `${2:name}`, `$0`), which is
 * also what LSP servers emit, so a user who has seen a snippet anywhere else
 * already knows the syntax.
 */
import { monaco } from '@/lib/monacoSetup'
import type * as monacoNs from 'monaco-editor'

export interface LiveTemplate {
  id: string
  /** What the user types before pressing Tab. */
  abbreviation: string
  description: string
  /** Monaco snippet syntax. */
  body: string
  /** Monaco language ids this applies to. Empty means everywhere. */
  languages: string[]
  /** False for user-defined templates, so they can be edited or removed. */
  builtin?: boolean
}

const JS_LIKE = ['javascript', 'typescript', 'javascriptreact', 'typescriptreact']

export const BUILTIN_TEMPLATES: LiveTemplate[] = [
  {
    id: 'iter',
    abbreviation: 'iter',
    description: 'for…of loop',
    body: 'for (const ${1:item} of ${2:items}) {\n\t$0\n}',
    languages: JS_LIKE,
    builtin: true,
  },
  {
    id: 'fori',
    abbreviation: 'fori',
    description: 'Indexed for loop',
    body: 'for (let ${1:i} = 0; $1 < ${2:n}; $1++) {\n\t$0\n}',
    languages: JS_LIKE,
    builtin: true,
  },
  {
    id: 'tryc',
    abbreviation: 'tryc',
    description: 'try/catch that actually reports',
    body: 'try {\n\t$0\n} catch (${1:err}) {\n\tconsole.error($1)\n}',
    languages: JS_LIKE,
    builtin: true,
  },
  {
    id: 'afn',
    abbreviation: 'afn',
    description: 'Async arrow function',
    body: 'const ${1:name} = async (${2:args}) => {\n\t$0\n}',
    languages: JS_LIKE,
    builtin: true,
  },
  {
    id: 'rfc',
    abbreviation: 'rfc',
    description: 'React function component',
    body:
      'interface ${1:Name}Props {\n\t$2\n}\n\nexport default function $1({ $3 }: $1Props) {\n\treturn (\n\t\t<div>$0</div>\n\t)\n}',
    languages: ['typescriptreact', 'typescript'],
    builtin: true,
  },
  {
    id: 'useState',
    abbreviation: 'usestate',
    description: 'useState hook',
    body: 'const [${1:value}, set${2:Value}] = useState(${3:initial})',
    languages: JS_LIKE,
    builtin: true,
  },
  {
    id: 'useEffect',
    abbreviation: 'useeffect',
    description: 'useEffect hook',
    body: 'useEffect(() => {\n\t$0\n}, [${1:deps}])',
    languages: JS_LIKE,
    builtin: true,
  },
  {
    id: 'desc',
    abbreviation: 'desc',
    description: 'describe block',
    body: "describe('${1:subject}', () => {\n\t$0\n})",
    languages: JS_LIKE,
    builtin: true,
  },
  {
    id: 'test',
    abbreviation: 'test',
    description: 'Test case',
    body: "it('${1:does something}', () => {\n\t$0\n})",
    languages: JS_LIKE,
    builtin: true,
  },
  {
    id: 'main-py',
    abbreviation: 'main',
    description: 'Python entry point guard',
    body: "if __name__ == '__main__':\n\t$0",
    languages: ['python'],
    builtin: true,
  },
  {
    id: 'def-py',
    abbreviation: 'def',
    description: 'Function with a docstring',
    body: 'def ${1:name}(${2:args}):\n\t"""${3:What it does.}"""\n\t$0',
    languages: ['python'],
    builtin: true,
  },
  {
    id: 'iferr-go',
    abbreviation: 'iferr',
    description: 'Go error check',
    body: 'if err != nil {\n\treturn ${1:err}\n}\n$0',
    languages: ['go'],
    builtin: true,
  },
]

/**
 * Registers a completion provider that offers templates.
 *
 * Given its own provider rather than merged into the symbol completions so
 * templates always sort together and always appear, even when a language
 * server is still starting.
 */
export function registerTemplates(getTemplates: () => LiveTemplate[]): monacoNs.IDisposable {
  return monaco.languages.registerCompletionItemProvider(
    { pattern: '**/*' },
    {
      provideCompletionItems(model, position) {
        const word = model.getWordUntilPosition(position)
        const language = model.getLanguageId()
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        }

        const suggestions = getTemplates()
          .filter((t) => !t.languages.length || t.languages.includes(language))
          .map((template) => ({
            label: template.abbreviation,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: template.description,
            documentation: { value: `\`\`\`\n${template.body.replace(/\$\{\d+:([^}]*)\}/g, '$1').replace(/\$\d+/g, '')}\n\`\`\`` },
            insertText: template.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            // Sorts templates just below exact symbol matches.
            sortText: `1_${template.abbreviation}`,
          }))

        return { suggestions }
      },
    },
  )
}
