/**
 * Ten first-class themes. Each one drives both the chrome (via CSS custom
 * properties) and the Monaco editor (via a generated Monaco theme), so the
 * whole IDE stays visually coherent when the theme changes.
 */

export interface ThemeSyntax {
  comment: string
  keyword: string
  string: string
  number: string
  func: string
  variable: string
  type: string
  constant: string
  operator: string
  tag: string
  attribute: string
  regexp: string
}

export interface ThemeColors {
  bg: string
  bgElevated: string
  bgInset: string
  sidebar: string
  panel: string
  titleBar: string
  statusBar: string
  border: string
  borderStrong: string
  text: string
  textMuted: string
  textFaint: string
  accent: string
  accentSoft: string
  accentText: string
  hover: string
  active: string
  selection: string
  editorBg: string
  editorLine: string
  cursor: string
  success: string
  warning: string
  danger: string
  info: string
  added: string
  removed: string
  addedBg: string
  removedBg: string
}

export interface Theme {
  id: string
  name: string
  type: 'dark' | 'light'
  colors: ThemeColors
  syntax: ThemeSyntax
}

export const themes: Theme[] = [
  {
    id: 'nova-dark',
    name: 'Nova Dark',
    type: 'dark',
    colors: {
      bg: '#0f1116',
      bgElevated: '#161922',
      bgInset: '#0a0c10',
      sidebar: '#12151c',
      panel: '#12151c',
      titleBar: '#0d0f14',
      statusBar: '#0d0f14',
      border: '#232733',
      borderStrong: '#333949',
      text: '#dfe4ee',
      textMuted: '#98a0b3',
      textFaint: '#646c7e',
      accent: '#6ea8fe',
      accentSoft: 'rgba(110,168,254,0.16)',
      accentText: '#0b1220',
      hover: 'rgba(255,255,255,0.05)',
      active: 'rgba(110,168,254,0.14)',
      selection: 'rgba(110,168,254,0.26)',
      editorBg: '#0f1116',
      editorLine: 'rgba(255,255,255,0.035)',
      cursor: '#6ea8fe',
      success: '#4ec9a5',
      warning: '#e3b341',
      danger: '#f0616d',
      info: '#6ea8fe',
      added: '#4ec9a5',
      removed: '#f0616d',
      addedBg: 'rgba(78,201,165,0.13)',
      removedBg: 'rgba(240,97,109,0.13)',
    },
    syntax: {
      comment: '#5c6474',
      keyword: '#c792ea',
      string: '#a5d6a7',
      number: '#f7a56c',
      func: '#82aaff',
      variable: '#dfe4ee',
      type: '#7fdbca',
      constant: '#f78c6c',
      operator: '#89ddff',
      tag: '#ff6b8b',
      attribute: '#ffcb6b',
      regexp: '#f78c6c',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    type: 'dark',
    colors: {
      bg: '#1a1b26',
      bgElevated: '#20222f',
      bgInset: '#16161e',
      sidebar: '#16161e',
      panel: '#16161e',
      titleBar: '#13131a',
      statusBar: '#13131a',
      border: '#2a2c3d',
      borderStrong: '#3b3d54',
      text: '#c0caf5',
      textMuted: '#8b93b8',
      textFaint: '#575e80',
      accent: '#7aa2f7',
      accentSoft: 'rgba(122,162,247,0.16)',
      accentText: '#11131c',
      hover: 'rgba(255,255,255,0.05)',
      active: 'rgba(122,162,247,0.15)',
      selection: 'rgba(122,162,247,0.28)',
      editorBg: '#1a1b26',
      editorLine: 'rgba(255,255,255,0.035)',
      cursor: '#7aa2f7',
      success: '#9ece6a',
      warning: '#e0af68',
      danger: '#f7768e',
      info: '#7dcfff',
      added: '#9ece6a',
      removed: '#f7768e',
      addedBg: 'rgba(158,206,106,0.13)',
      removedBg: 'rgba(247,118,142,0.13)',
    },
    syntax: {
      comment: '#565f89',
      keyword: '#bb9af7',
      string: '#9ece6a',
      number: '#ff9e64',
      func: '#7aa2f7',
      variable: '#c0caf5',
      type: '#2ac3de',
      constant: '#ff9e64',
      operator: '#89ddff',
      tag: '#f7768e',
      attribute: '#e0af68',
      regexp: '#b4f9f8',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    type: 'dark',
    colors: {
      bg: '#282a36',
      bgElevated: '#31333f',
      bgInset: '#21222c',
      sidebar: '#21222c',
      panel: '#21222c',
      titleBar: '#1c1d26',
      statusBar: '#1c1d26',
      border: '#3a3c4e',
      borderStrong: '#4d5066',
      text: '#f8f8f2',
      textMuted: '#a9adc1',
      textFaint: '#6d7089',
      accent: '#bd93f9',
      accentSoft: 'rgba(189,147,249,0.18)',
      accentText: '#1c1d26',
      hover: 'rgba(255,255,255,0.06)',
      active: 'rgba(189,147,249,0.18)',
      selection: 'rgba(189,147,249,0.3)',
      editorBg: '#282a36',
      editorLine: 'rgba(255,255,255,0.04)',
      cursor: '#f8f8f2',
      success: '#50fa7b',
      warning: '#f1fa8c',
      danger: '#ff5555',
      info: '#8be9fd',
      added: '#50fa7b',
      removed: '#ff5555',
      addedBg: 'rgba(80,250,123,0.12)',
      removedBg: 'rgba(255,85,85,0.13)',
    },
    syntax: {
      comment: '#6272a4',
      keyword: '#ff79c6',
      string: '#f1fa8c',
      number: '#bd93f9',
      func: '#50fa7b',
      variable: '#f8f8f2',
      type: '#8be9fd',
      constant: '#bd93f9',
      operator: '#ff79c6',
      tag: '#ff79c6',
      attribute: '#50fa7b',
      regexp: '#ffb86c',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    type: 'dark',
    colors: {
      bg: '#2e3440',
      bgElevated: '#373e4d',
      bgInset: '#272c36',
      sidebar: '#2b303b',
      panel: '#2b303b',
      titleBar: '#252a33',
      statusBar: '#252a33',
      border: '#3b4252',
      borderStrong: '#4c566a',
      text: '#e5e9f0',
      textMuted: '#a4adc0',
      textFaint: '#6f7889',
      accent: '#88c0d0',
      accentSoft: 'rgba(136,192,208,0.18)',
      accentText: '#20242c',
      hover: 'rgba(255,255,255,0.05)',
      active: 'rgba(136,192,208,0.18)',
      selection: 'rgba(136,192,208,0.28)',
      editorBg: '#2e3440',
      editorLine: 'rgba(255,255,255,0.035)',
      cursor: '#88c0d0',
      success: '#a3be8c',
      warning: '#ebcb8b',
      danger: '#bf616a',
      info: '#81a1c1',
      added: '#a3be8c',
      removed: '#bf616a',
      addedBg: 'rgba(163,190,140,0.14)',
      removedBg: 'rgba(191,97,106,0.16)',
    },
    syntax: {
      comment: '#616e88',
      keyword: '#81a1c1',
      string: '#a3be8c',
      number: '#b48ead',
      func: '#88c0d0',
      variable: '#e5e9f0',
      type: '#8fbcbb',
      constant: '#b48ead',
      operator: '#81a1c1',
      tag: '#81a1c1',
      attribute: '#8fbcbb',
      regexp: '#ebcb8b',
    },
  },
  {
    id: 'one-dark',
    name: 'One Dark Pro',
    type: 'dark',
    colors: {
      bg: '#282c34',
      bgElevated: '#31363f',
      bgInset: '#21252b',
      sidebar: '#21252b',
      panel: '#21252b',
      titleBar: '#1c2027',
      statusBar: '#1c2027',
      border: '#3a3f4b',
      borderStrong: '#4b5263',
      text: '#abb2bf',
      textMuted: '#828997',
      textFaint: '#5c6370',
      accent: '#61afef',
      accentSoft: 'rgba(97,175,239,0.16)',
      accentText: '#1c2027',
      hover: 'rgba(255,255,255,0.05)',
      active: 'rgba(97,175,239,0.16)',
      selection: 'rgba(97,175,239,0.26)',
      editorBg: '#282c34',
      editorLine: 'rgba(255,255,255,0.035)',
      cursor: '#528bff',
      success: '#98c379',
      warning: '#e5c07b',
      danger: '#e06c75',
      info: '#56b6c2',
      added: '#98c379',
      removed: '#e06c75',
      addedBg: 'rgba(152,195,121,0.13)',
      removedBg: 'rgba(224,108,117,0.13)',
    },
    syntax: {
      comment: '#5c6370',
      keyword: '#c678dd',
      string: '#98c379',
      number: '#d19a66',
      func: '#61afef',
      variable: '#e06c75',
      type: '#e5c07b',
      constant: '#d19a66',
      operator: '#56b6c2',
      tag: '#e06c75',
      attribute: '#d19a66',
      regexp: '#98c379',
    },
  },
  {
    id: 'monokai-pro',
    name: 'Monokai Pro',
    type: 'dark',
    colors: {
      bg: '#2d2a2e',
      bgElevated: '#37343a',
      bgInset: '#221f22',
      sidebar: '#262329',
      panel: '#262329',
      titleBar: '#221f22',
      statusBar: '#221f22',
      border: '#403e41',
      borderStrong: '#5b595c',
      text: '#fcfcfa',
      textMuted: '#b0aeb2',
      textFaint: '#727072',
      accent: '#ffd866',
      accentSoft: 'rgba(255,216,102,0.16)',
      accentText: '#221f22',
      hover: 'rgba(255,255,255,0.05)',
      active: 'rgba(255,216,102,0.14)',
      selection: 'rgba(255,216,102,0.24)',
      editorBg: '#2d2a2e',
      editorLine: 'rgba(255,255,255,0.035)',
      cursor: '#ffd866',
      success: '#a9dc76',
      warning: '#fc9867',
      danger: '#ff6188',
      info: '#78dce8',
      added: '#a9dc76',
      removed: '#ff6188',
      addedBg: 'rgba(169,220,118,0.13)',
      removedBg: 'rgba(255,97,136,0.13)',
    },
    syntax: {
      comment: '#727072',
      keyword: '#ff6188',
      string: '#ffd866',
      number: '#ab9df2',
      func: '#a9dc76',
      variable: '#fcfcfa',
      type: '#78dce8',
      constant: '#ab9df2',
      operator: '#ff6188',
      tag: '#ff6188',
      attribute: '#a9dc76',
      regexp: '#fc9867',
    },
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    type: 'dark',
    colors: {
      bg: '#282828',
      bgElevated: '#32302f',
      bgInset: '#1d2021',
      sidebar: '#232323',
      panel: '#232323',
      titleBar: '#1d2021',
      statusBar: '#1d2021',
      border: '#3c3836',
      borderStrong: '#504945',
      text: '#ebdbb2',
      textMuted: '#a89984',
      textFaint: '#7c6f64',
      accent: '#fabd2f',
      accentSoft: 'rgba(250,189,47,0.16)',
      accentText: '#1d2021',
      hover: 'rgba(255,255,255,0.05)',
      active: 'rgba(250,189,47,0.15)',
      selection: 'rgba(250,189,47,0.24)',
      editorBg: '#282828',
      editorLine: 'rgba(255,255,255,0.035)',
      cursor: '#fabd2f',
      success: '#b8bb26',
      warning: '#fe8019',
      danger: '#fb4934',
      info: '#83a598',
      added: '#b8bb26',
      removed: '#fb4934',
      addedBg: 'rgba(184,187,38,0.13)',
      removedBg: 'rgba(251,73,52,0.13)',
    },
    syntax: {
      comment: '#928374',
      keyword: '#fb4934',
      string: '#b8bb26',
      number: '#d3869b',
      func: '#fabd2f',
      variable: '#ebdbb2',
      type: '#8ec07c',
      constant: '#d3869b',
      operator: '#fe8019',
      tag: '#fb4934',
      attribute: '#8ec07c',
      regexp: '#fe8019',
    },
  },
  {
    id: 'midnight-ocean',
    name: 'Midnight Ocean',
    type: 'dark',
    colors: {
      bg: '#0b1a26',
      bgElevated: '#122535',
      bgInset: '#07131c',
      sidebar: '#0d1e2c',
      panel: '#0d1e2c',
      titleBar: '#07131c',
      statusBar: '#07131c',
      border: '#173347',
      borderStrong: '#22506e',
      text: '#d6e6f2',
      textMuted: '#8fa9bd',
      textFaint: '#5c7488',
      accent: '#2ec4b6',
      accentSoft: 'rgba(46,196,182,0.16)',
      accentText: '#04121a',
      hover: 'rgba(255,255,255,0.05)',
      active: 'rgba(46,196,182,0.16)',
      selection: 'rgba(46,196,182,0.26)',
      editorBg: '#0b1a26',
      editorLine: 'rgba(255,255,255,0.035)',
      cursor: '#2ec4b6',
      success: '#2ec4b6',
      warning: '#ffb703',
      danger: '#ef476f',
      info: '#4cc9f0',
      added: '#2ec4b6',
      removed: '#ef476f',
      addedBg: 'rgba(46,196,182,0.13)',
      removedBg: 'rgba(239,71,111,0.13)',
    },
    syntax: {
      comment: '#4d6879',
      keyword: '#4cc9f0',
      string: '#8ce99a',
      number: '#ffb703',
      func: '#2ec4b6',
      variable: '#d6e6f2',
      type: '#a78bfa',
      constant: '#ffb703',
      operator: '#4cc9f0',
      tag: '#ef476f',
      attribute: '#ffd166',
      regexp: '#ffd166',
    },
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    type: 'light',
    colors: {
      bg: '#ffffff',
      bgElevated: '#f6f8fa',
      bgInset: '#eaeef2',
      sidebar: '#f6f8fa',
      panel: '#f6f8fa',
      titleBar: '#eef1f4',
      statusBar: '#eef1f4',
      border: '#d8dee4',
      borderStrong: '#b9c1c9',
      text: '#1f2328',
      textMuted: '#59636e',
      textFaint: '#818b98',
      accent: '#0969da',
      accentSoft: 'rgba(9,105,218,0.1)',
      accentText: '#ffffff',
      hover: 'rgba(0,0,0,0.04)',
      active: 'rgba(9,105,218,0.1)',
      selection: 'rgba(9,105,218,0.18)',
      editorBg: '#ffffff',
      editorLine: 'rgba(0,0,0,0.03)',
      cursor: '#0969da',
      success: '#1a7f37',
      warning: '#9a6700',
      danger: '#cf222e',
      info: '#0969da',
      added: '#1a7f37',
      removed: '#cf222e',
      addedBg: 'rgba(26,127,55,0.1)',
      removedBg: 'rgba(207,34,46,0.1)',
    },
    syntax: {
      comment: '#6e7781',
      keyword: '#cf222e',
      string: '#0a3069',
      number: '#0550ae',
      func: '#8250df',
      variable: '#1f2328',
      type: '#953800',
      constant: '#0550ae',
      operator: '#0550ae',
      tag: '#116329',
      attribute: '#0550ae',
      regexp: '#0a3069',
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    type: 'light',
    colors: {
      bg: '#fdf6e3',
      bgElevated: '#f5eed8',
      bgInset: '#eee8d5',
      sidebar: '#f2ecd8',
      panel: '#f2ecd8',
      titleBar: '#eee8d5',
      statusBar: '#eee8d5',
      border: '#ddd6c1',
      borderStrong: '#c3bda8',
      text: '#586e75',
      textMuted: '#7a8f96',
      textFaint: '#93a1a1',
      accent: '#268bd2',
      accentSoft: 'rgba(38,139,210,0.12)',
      accentText: '#fdf6e3',
      hover: 'rgba(0,0,0,0.04)',
      active: 'rgba(38,139,210,0.12)',
      selection: 'rgba(38,139,210,0.2)',
      editorBg: '#fdf6e3',
      editorLine: 'rgba(0,0,0,0.03)',
      cursor: '#268bd2',
      success: '#859900',
      warning: '#b58900',
      danger: '#dc322f',
      info: '#268bd2',
      added: '#859900',
      removed: '#dc322f',
      addedBg: 'rgba(133,153,0,0.14)',
      removedBg: 'rgba(220,50,47,0.12)',
    },
    syntax: {
      comment: '#93a1a1',
      keyword: '#859900',
      string: '#2aa198',
      number: '#d33682',
      func: '#268bd2',
      variable: '#586e75',
      type: '#b58900',
      constant: '#cb4b16',
      operator: '#859900',
      tag: '#268bd2',
      attribute: '#b58900',
      regexp: '#dc322f',
    },
  },
]

export const defaultThemeId = 'nova-dark'

export function getTheme(id: string): Theme {
  return themes.find((t) => t.id === id) ?? themes[0]
}

/** Writes the theme onto :root as CSS custom properties. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(`--${kebab(key)}`, value)
  }
  for (const [key, value] of Object.entries(theme.syntax)) {
    root.style.setProperty(`--syn-${kebab(key)}`, value)
  }
  root.dataset.theme = theme.id
  root.dataset.themeType = theme.type
  root.style.colorScheme = theme.type
}

function kebab(s: string) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function hex(color: string, fallback: string) {
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback
}

/**
 * Monaco only accepts `#RRGGBB` / `#RRGGBBAA`; a CSS `rgba()` string silently
 * falls back to a garish default, so translate before handing colours over.
 */
function monacoColor(color: string, fallback: string): string {
  if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color)) return color
  const match = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i,
  )
  if (!match) return fallback
  const [r, g, b] = [match[1], match[2], match[3]].map((v) => clamp255(Number(v)))
  const alpha = match[4] === undefined ? 255 : clamp255(Math.round(Number(match[4]) * 255))
  return `#${[r, g, b, alpha].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function clamp255(value: number) {
  return Math.min(255, Math.max(0, Number.isFinite(value) ? value : 0))
}

/** Builds a Monaco theme definition from a Nova theme. */
export function monacoThemeData(theme: Theme) {
  const s = theme.syntax
  const c = theme.colors
  const base = theme.type === 'dark' ? 'vs-dark' : 'vs'
  const strip = (v: string) => v.replace('#', '')
  return {
    base: base as 'vs' | 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: strip(hex(c.text, '#cccccc')) },
      { token: 'comment', foreground: strip(s.comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: strip(s.keyword) },
      { token: 'keyword.control', foreground: strip(s.keyword) },
      { token: 'storage', foreground: strip(s.keyword) },
      { token: 'string', foreground: strip(s.string) },
      { token: 'string.quoted', foreground: strip(s.string) },
      { token: 'number', foreground: strip(s.number) },
      { token: 'constant', foreground: strip(s.constant) },
      { token: 'constant.numeric', foreground: strip(s.number) },
      { token: 'constant.language', foreground: strip(s.constant) },
      { token: 'entity.name.function', foreground: strip(s.func) },
      { token: 'support.function', foreground: strip(s.func) },
      { token: 'variable', foreground: strip(s.variable) },
      { token: 'variable.parameter', foreground: strip(s.variable) },
      { token: 'type', foreground: strip(s.type) },
      { token: 'type.identifier', foreground: strip(s.type) },
      { token: 'entity.name.type', foreground: strip(s.type) },
      { token: 'identifier', foreground: strip(c.text) },
      { token: 'operator', foreground: strip(s.operator) },
      { token: 'delimiter', foreground: strip(c.textMuted) },
      { token: 'tag', foreground: strip(s.tag) },
      { token: 'metatag', foreground: strip(s.tag) },
      { token: 'attribute.name', foreground: strip(s.attribute) },
      { token: 'attribute.value', foreground: strip(s.string) },
      { token: 'regexp', foreground: strip(s.regexp) },
      { token: 'annotation', foreground: strip(s.attribute) },
      { token: 'key', foreground: strip(s.tag) },
      { token: 'namespace', foreground: strip(s.type) },
    ],
    colors: {
      'editor.background': hex(c.editorBg, '#1e1e1e'),
      'editor.foreground': hex(c.text, '#cccccc'),
      'editorLineNumber.foreground': hex(c.textFaint, '#858585'),
      'editorLineNumber.activeForeground': hex(c.text, '#cccccc'),
      'editorCursor.foreground': hex(c.cursor, '#ffffff'),
      'editor.selectionBackground': monacoColor(c.selection, '#264f78'),
      'editor.inactiveSelectionBackground': monacoColor(c.hover, '#3a3d41'),
      'editor.lineHighlightBackground': monacoColor(c.editorLine, '#ffffff08'),
      'editorIndentGuide.background1': hex(c.border, '#404040'),
      'editorIndentGuide.activeBackground1': hex(c.borderStrong, '#707070'),
      'editorWidget.background': hex(c.bgElevated, '#252526'),
      'editorWidget.border': hex(c.border, '#454545'),
      'editorSuggestWidget.background': hex(c.bgElevated, '#252526'),
      'editorSuggestWidget.border': hex(c.border, '#454545'),
      'editorSuggestWidget.selectedBackground': monacoColor(c.active, '#04395e'),
      'editorGutter.addedBackground': hex(c.added, '#587c0c'),
      'editorGutter.deletedBackground': hex(c.removed, '#94151b'),
      'editorGutter.modifiedBackground': hex(c.accent, '#0c7d9d'),
      'diffEditor.insertedTextBackground': monacoColor(c.addedBg, '#9bb95533'),
      'diffEditor.removedTextBackground': monacoColor(c.removedBg, '#ff000033'),
      'scrollbarSlider.background': monacoColor(c.hover, '#79797966'),
      'scrollbarSlider.hoverBackground': monacoColor(c.active, '#646464b3'),
      'minimap.background': hex(c.editorBg, '#1e1e1e'),
    },
  }
}
