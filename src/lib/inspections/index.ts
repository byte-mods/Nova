/**
 * Runs inspections over a model and turns them into markers and quick fixes.
 *
 * Markers are published under their own owner so they sit alongside the
 * language server's diagnostics in the Problems panel rather than replacing
 * them — the two answer different questions and a user wants both.
 */
import { monaco } from '@/lib/monacoSetup'
import type * as monacoNs from 'monaco-editor'
import { RULES, RULES_BY_ID, type InspectionMatch, type InspectionSeverity } from './rules'

export const INSPECTION_OWNER = 'nova-inspections'

/** Severity overrides, by rule id. Absent means the rule's default. */
export type InspectionProfile = Record<string, InspectionSeverity>

/** A match plus the rule it came from, kept so the fix can be offered later. */
interface Found extends InspectionMatch {
  ruleId: string
  severity: InspectionSeverity
}

/**
 * Per-model results, so the code-action provider can answer without re-running
 * every rule for the range Monaco asks about.
 */
const results = new Map<string, Found[]>()

function severityOf(severity: InspectionSeverity): monacoNs.MarkerSeverity {
  switch (severity) {
    case 'error':
      return monaco.MarkerSeverity.Error
    case 'warning':
      return monaco.MarkerSeverity.Warning
    default:
      return monaco.MarkerSeverity.Info
  }
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot).toLowerCase()
}

/** Runs every enabled rule over the model and publishes markers. */
export function inspect(model: monacoNs.editor.ITextModel, profile: InspectionProfile = {}): void {
  const path = model.uri.path
  const extension = extensionOf(path)
  const lines = model.getLinesContent()
  const found: Found[] = []

  for (const rule of RULES) {
    const severity = profile[rule.id] ?? rule.defaultSeverity
    if (severity === 'off') continue
    if (rule.extensions.length && !rule.extensions.includes(extension)) continue

    for (let i = 0; i < lines.length; i++) {
      // Rules take a 1-based line number; `context.lines` stays 0-based so a
      // rule can look ahead with `lines[lineNumber]`.
      const matches = rule.run(lines[i], i + 1, { path, lines })
      if (!matches.length) continue
      if (isSuppressed(lines, i, rule.id)) continue
      for (const match of matches) found.push({ ...match, ruleId: rule.id, severity })
    }
  }

  results.set(model.uri.toString(), found)

  monaco.editor.setModelMarkers(
    model,
    INSPECTION_OWNER,
    found.map((f) => ({
      startLineNumber: f.line,
      startColumn: f.column,
      endLineNumber: f.line,
      endColumn: f.endColumn,
      message: f.message,
      severity: severityOf(f.severity),
      source: RULES_BY_ID.get(f.ruleId)?.name ?? 'Inspection',
      code: f.ruleId,
    })),
  )
}

export function clearInspections(model: monacoNs.editor.ITextModel): void {
  results.delete(model.uri.toString())
  monaco.editor.setModelMarkers(model, INSPECTION_OWNER, [])
}

/**
 * Offers the fixes for whatever inspections overlap the given range.
 *
 * Registered once per language at startup; Monaco calls it when the user opens
 * the lightbulb or presses the quick-fix shortcut.
 */
export function registerInspectionCodeActions(): monacoNs.IDisposable {
  return monaco.languages.registerCodeActionProvider(
    { pattern: '**/*' },
    {
      provideCodeActions(model, range) {
        const found = results.get(model.uri.toString()) ?? []
        const actions: monacoNs.languages.CodeAction[] = []

        for (const f of found) {
          if (f.line < range.startLineNumber || f.line > range.endLineNumber) continue
          const rule = RULES_BY_ID.get(f.ruleId)

          if (f.fix) {
            actions.push({
              title: f.fix.title,
              kind: 'quickfix',
              isPreferred: true,
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: new monaco.Range(f.line, f.column, f.line, f.endColumn),
                      text: f.fix.text,
                    },
                  },
                ],
              },
            })
          }

          if (f.fixDeleteLine) {
            // Delete the whole line including its newline, so removing a
            // statement does not leave a blank gap behind.
            const lineCount = model.getLineCount()
            const endLine = f.line < lineCount ? f.line + 1 : f.line
            const endColumn = f.line < lineCount ? 1 : model.getLineMaxColumn(f.line)
            actions.push({
              title: f.fixDeleteLine.title,
              kind: 'quickfix',
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: { range: new monaco.Range(f.line, 1, endLine, endColumn), text: '' },
                  },
                ],
              },
            })
          }

          if (rule) {
            actions.push({
              title: `Suppress "${rule.name}" on this line`,
              kind: 'quickfix',
              edit: {
                edits: [
                  {
                    resource: model.uri,
                    versionId: model.getVersionId(),
                    textEdit: {
                      range: new monaco.Range(f.line, 1, f.line, 1),
                      text: `${leadingWhitespace(model.getLineContent(f.line))}// nova-ignore ${rule.id}\n`,
                    },
                  },
                ],
              },
            })
          }
        }

        return { actions, dispose: () => {} }
      },
    },
  )
}

function leadingWhitespace(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? ''
}

/**
 * Honours `// nova-ignore <rule-id>` on the line above, or a trailing
 * `// nova-ignore <rule-id>` on the line itself.
 *
 * A bare `nova-ignore` with no id suppresses every rule on that line, which is
 * the escape hatch for a line a rule is simply wrong about.
 */
function isSuppressed(lines: string[], index: number, ruleId: string): boolean {
  const check = (line: string | undefined): boolean => {
    if (!line) return false
    const match = /nova-ignore(?:\s+([\w-]+(?:\s*,\s*[\w-]+)*))?/.exec(line)
    if (!match) return false
    if (!match[1]) return true
    return match[1].split(/\s*,\s*/).includes(ruleId)
  }
  return check(lines[index]) || check(lines[index - 1])
}

/** Rule metadata, for the settings screen. */
export function inspectionCatalogue() {
  return RULES.map((rule) => ({
    id: rule.id,
    name: rule.name,
    description: rule.description,
    defaultSeverity: rule.defaultSeverity,
    extensions: rule.extensions,
  }))
}
