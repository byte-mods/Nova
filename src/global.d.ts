import type { NovaApi } from '../electron/preload'

declare global {
  interface Window {
    nova: NovaApi
  }

  namespace JSX {
    interface IntrinsicElements {
      /** Electron's <webview> tag, used by the built-in browser pane. */
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          allowpopups?: string
          partition?: string
          useragent?: string
          preload?: string
          webpreferences?: string
        },
        HTMLElement
      >
    }
  }
}

export {}
