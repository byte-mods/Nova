import { useEffect, useMemo, useRef, useState } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import mermaid from 'mermaid'
import { monaco } from '@/lib/monacoSetup'
import { useStore } from '@/state/store'
import { getTheme } from '@/theme/themes'
import { dirname, joinPath } from '@/lib/paths'

let mermaidSeq = 0

interface Props {
  content: string
  /** Path of the source document, used to resolve relative image links. */
  basePath?: string
}

/**
 * Markdown preview with Monaco-powered syntax highlighting for fenced code and
 * live Mermaid rendering for ```mermaid blocks.
 */
export default function Markdown({ content, basePath }: Props) {
  const themeId = useStore((s) => s.settings.themeId)
  const ref = useRef<HTMLDivElement>(null)
  const [html, setHtml] = useState('')

  const parsed = useMemo(() => {
    marked.setOptions({ gfm: true, breaks: false })
    const raw = marked.parse(content, { async: false }) as string
    return DOMPurify.sanitize(raw, {
      ADD_TAGS: ['input'],
      ADD_ATTR: ['target', 'checked', 'disabled', 'type', 'align'],
    })
  }, [content])

  useEffect(() => setHtml(parsed), [parsed])

  useEffect(() => {
    const host = ref.current
    if (!host) return
    let cancelled = false
    const theme = getTheme(themeId)

    // Mermaid fences become live diagrams.
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        darkMode: theme.type === 'dark',
        background: theme.colors.editorBg,
        primaryColor: theme.colors.bgElevated,
        primaryTextColor: theme.colors.text,
        primaryBorderColor: theme.colors.accent,
        lineColor: theme.colors.textMuted,
        textColor: theme.colors.text,
        mainBkg: theme.colors.bgElevated,
      },
    })

    host.querySelectorAll<HTMLElement>('pre > code').forEach((code) => {
      const className = code.className || ''
      const language = className.replace('language-', '').trim()
      const source = code.textContent ?? ''

      if (language === 'mermaid') {
        const holder = document.createElement('div')
        holder.className = 'md-mermaid'
        code.parentElement?.replaceWith(holder)
        mermaid
          .render(`md-mermaid-${++mermaidSeq}`, source)
          .then(({ svg }) => {
            if (!cancelled) holder.innerHTML = svg
          })
          .catch((err) => {
            if (!cancelled) {
              holder.className = 'md-mermaid-error'
              holder.textContent = err instanceof Error ? err.message : String(err)
            }
          })
        return
      }

      if (!language) return
      void monaco.editor
        .colorize(source, mapLanguage(language), { tabSize: 2 })
        .then((colored) => {
          if (!cancelled) code.innerHTML = colored
        })
        .catch(() => undefined)
    })

    // Relative images resolve against the document's folder.
    if (basePath) {
      host.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
        const src = img.getAttribute('src') ?? ''
        if (!/^(https?:|data:|file:)/.test(src)) {
          img.src = `file://${joinPath(dirname(basePath), src)}`
        }
      })
    }

    // External links open in the built-in browser instead of navigating the app.
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? ''
      e.preventDefault()
      if (/^https?:/.test(href)) {
        useStore.getState().openTab({
          id: `browser:${href}`,
          kind: 'browser',
          title: 'Browser',
          url: href,
        })
      } else if (href.startsWith('#')) {
        host.querySelector(`#${CSS.escape(href.slice(1))}`)?.scrollIntoView({ behavior: 'smooth' })
      } else if (basePath) {
        void useStore.getState().openFile(joinPath(dirname(basePath), href))
      }
    }
    host.addEventListener('click', onClick)

    return () => {
      cancelled = true
      host.removeEventListener('click', onClick)
    }
  }, [html, themeId, basePath])

  return <div className="markdown-body" ref={ref} dangerouslySetInnerHTML={{ __html: html }} />
}

function mapLanguage(language: string) {
  const alias: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    yml: 'yaml',
    py: 'python',
    rb: 'ruby',
    rs: 'rust',
    golang: 'go',
    'c++': 'cpp',
    'c#': 'csharp',
    text: 'plaintext',
  }
  return alias[language] ?? language
}
