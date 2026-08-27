/**
 * The assistants Nova can drive, and which binary each one runs.
 *
 * Every provider gets the CLI its vendor actually ships: `claude`, `codex`,
 * `gemini`, `kimi`, and `opencode` for everything else. That last one is not a
 * fallback in the apologetic sense — OpenCode is a real client that speaks to
 * whichever provider it has configured, so GLM and DeepSeek run through it
 * rather than through an endpoint pretending to be someone else's API.
 *
 * The earlier arrangement pointed several providers at the Claude CLI with
 * `ANTHROPIC_BASE_URL` redirected. It worked, and it was the wrong shape: it
 * inherited another vendor's auth precedence rules (which is how a personal
 * Anthropic token nearly went to a third party), and it meant a model was only
 * ever as good as its ability to impersonate a different vendor's protocol.
 * Running the vendor's own CLI is both safer and more honest about what is
 * happening.
 *
 * `dialect` is how the output stream is read, not who made it — Gemini and Kimi
 * both emit the same JSONL event shapes, so they share a reader.
 */
import type { AiProvider } from './types'

/**
 * How much thinking a model does, and what it costs to get it.
 *
 * `fast` is for the turn you want back immediately; `deep` for the one worth
 * waiting on. The middle is the sane default, which is why it is what a fresh
 * install uses.
 */
export type ModelTier = 'fast' | 'balanced' | 'deep'

export const MODEL_TIERS: { id: ModelTier; label: string; detail: string }[] = [
  { id: 'fast', label: 'Fast', detail: 'Answers soonest, cheapest. Good for questions and small edits.' },
  { id: 'balanced', label: 'Balanced', detail: 'The default trade between speed and depth.' },
  { id: 'deep', label: 'Deep', detail: 'Thinks longest. Worth it for design work and hard bugs.' },
]

export interface AiProviderSpec {
  id: AiProvider
  label: string
  /** The executable that actually runs. */
  binary: string
  /**
   * How the stream is parsed. `claude` covers every Anthropic-compatible
   * vendor, which is why they are not listed separately here.
   */
  dialect: 'claude' | 'codex' | 'opencode' | 'gemini'
  /**
   * The environment variable this CLI reads its credential from.
   *
   * Set only for the providers that need a key Nova holds. Claude, Codex and
   * OpenCode each manage their own sign-in, so Nova stays out of it — asking
   * for a key it does not need would be worse than asking for nothing.
   */
  keyEnv?: string
  /** Where the user gets that key. */
  console?: string
  /** Suggested model id, shown as the placeholder in Settings. */
  defaultModel?: string
  /**
   * Models this CLI can be pointed at, cheapest first.
   *
   * A list, not a free-text box, because the failure of a typo is a run that
   * gets partway in and dies on an unrecognised model. `tier` is the trade
   * being made — a smaller model answers sooner and costs less; a larger one
   * thinks longer — expressed the way vendors actually ship it, as a choice of
   * model rather than as an abstract dial.
   *
   * Empty for OpenCode, whose models are whatever Ollama has pulled locally and
   * are therefore discovered at runtime rather than listed here.
   */
  models?: { id: string; label: string; tier: ModelTier }[]
  /**
   * Reasoning-effort values this CLI accepts as a flag.
   *
   * Only set where the vendor genuinely exposes one. Offering a dial that
   * silently does nothing would be worse than not offering it.
   */
  efforts?: string[]
  /** Shown in Settings when the provider is not usable yet. */
  install: string
}

export const AI_PROVIDERS: AiProviderSpec[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    dialect: 'claude',
    models: [
      { id: 'haiku', label: 'Haiku', tier: 'fast' },
      { id: 'sonnet', label: 'Sonnet', tier: 'balanced' },
      { id: 'opus', label: 'Opus', tier: 'deep' },
    ],
    install: 'npm i -g @anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    dialect: 'codex',
    models: [
      { id: 'gpt-5-codex-mini', label: 'GPT-5 Codex mini', tier: 'fast' },
      { id: 'gpt-5-codex', label: 'GPT-5 Codex', tier: 'balanced' },
    ],
    // `codex exec` takes this straight through as a config override.
    efforts: ['low', 'medium', 'high'],
    install: 'npm i -g @openai/codex',
  },
  {
    id: 'opencode',
    label: 'OpenCode (local)',
    binary: 'opencode',
    dialect: 'opencode',
    install: 'npm i -g opencode-ai — then a local model runs through Ollama',
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot)',
    binary: 'kimi',
    dialect: 'gemini',
    keyEnv: 'MOONSHOT_API_KEY',
    console: 'https://platform.moonshot.ai/console/api-keys',
    defaultModel: 'kimi-k2-turbo-preview',
    models: [
      { id: 'kimi-k2-turbo-preview', label: 'K2 Turbo', tier: 'fast' },
      { id: 'kimi-k2-0905-preview', label: 'K2', tier: 'balanced' },
      { id: 'kimi-k2-thinking', label: 'K2 Thinking', tier: 'deep' },
    ],
    install: 'Install the Kimi CLI: uv tool install kimi-cli — then add a Moonshot key in Settings › AI',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    binary: 'gemini',
    dialect: 'gemini',
    keyEnv: 'GEMINI_API_KEY',
    console: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-2.5-pro',
    models: [
      { id: 'gemini-2.5-flash-lite', label: '2.5 Flash Lite', tier: 'fast' },
      { id: 'gemini-2.5-flash', label: '2.5 Flash', tier: 'balanced' },
      { id: 'gemini-2.5-pro', label: '2.5 Pro', tier: 'deep' },
    ],
    install: 'npm i -g @google/gemini-cli — then add a Gemini key in Settings › AI, or run `gemini` once to sign in',
  },
  {
    id: 'glm',
    label: 'GLM (Z.ai)',
    binary: 'opencode',
    dialect: 'opencode',
    keyEnv: 'ZHIPU_API_KEY',
    console: 'https://z.ai/manage-apikey/apikey-list',
    defaultModel: 'zhipuai/glm-4.6',
    models: [
      { id: 'zhipuai/glm-4.5-air', label: 'GLM 4.5 Air', tier: 'fast' },
      { id: 'zhipuai/glm-4.6', label: 'GLM 4.6', tier: 'balanced' },
    ],
    install: 'npm i -g opencode-ai — then add a Z.ai key in Settings › AI',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    binary: 'opencode',
    dialect: 'opencode',
    keyEnv: 'DEEPSEEK_API_KEY',
    console: 'https://platform.deepseek.com/api_keys',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      { id: 'deepseek/deepseek-chat', label: 'Chat', tier: 'balanced' },
      { id: 'deepseek/deepseek-reasoner', label: 'Reasoner', tier: 'deep' },
    ],
    install: 'npm i -g opencode-ai — then add a DeepSeek key in Settings › AI',
  },
]

export function providerSpec(id: AiProvider): AiProviderSpec {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0]
}

/** Providers whose credential Nova stores, so Settings can ask for it. */
export function keyedProviders(): AiProviderSpec[] {
  return AI_PROVIDERS.filter((p) => p.keyEnv)
}
