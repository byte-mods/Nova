import { useEffect, useMemo, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { useStore } from '@/state/store'
import { getTheme } from '@/theme/themes'

let seq = 0

/** Renders a Mermaid source string, themed to match the active Nova theme. */
export default function MermaidView({ code }: { code: string }) {
  const themeId = useStore((s) => s.settings.themeId)
  const theme = useMemo(() => getTheme(themeId), [themeId])
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const c = theme.colors

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      theme: 'base',
      themeVariables: {
        darkMode: theme.type === 'dark',
        background: c.editorBg,
        primaryColor: c.bgElevated,
        primaryTextColor: c.text,
        primaryBorderColor: c.accent,
        secondaryColor: c.bgInset,
        tertiaryColor: c.bgInset,
        lineColor: c.textMuted,
        textColor: c.text,
        mainBkg: c.bgElevated,
        nodeBorder: c.accent,
        clusterBkg: c.bgInset,
        clusterBorder: c.border,
        titleColor: c.text,
        edgeLabelBackground: c.bgInset,
        actorBkg: c.bgElevated,
        actorBorder: c.accent,
        actorTextColor: c.text,
        signalColor: c.textMuted,
        signalTextColor: c.text,
        labelBoxBkgColor: c.bgElevated,
        labelBoxBorderColor: c.border,
        noteBkgColor: c.accentSoft,
        noteTextColor: c.text,
        noteBorderColor: c.accent,
      } as Record<string, unknown>,
    })

    const id = `mermaid-${++seq}`
    mermaid
      .render(id, code || 'flowchart TD\n  A[Empty diagram]')
      .then((result) => {
        if (cancelled) return
        setSvg(result.svg)
        setError('')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      // Mermaid leaves its measurement node behind on failure.
      document.getElementById(`d${id}`)?.remove()
    }
  }, [code, theme])

  return (
    <div className="mermaid-host" ref={hostRef}>
      {error ? (
        <pre className="mermaid-error">{error}</pre>
      ) : (
        <div className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  )
}
