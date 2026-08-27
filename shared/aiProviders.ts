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
 *
 * **The model ids below are suggestions, checked against each vendor's own
 * documentation in August 2026, and they will go out of date.** That is not a
 * flaw to be fixed by checking harder: vendors ship models faster than an
 * editor ships releases. The field these populate accepts anything typed into
 * it, and remembers what has actually been used, so a model released tomorrow
 * works today without waiting for anyone. Where a vendor offers an alias that
 * follows its own latest — Claude's `opus`, `sonnet` — the alias is preferred
 * over a pinned id for exactly that reason.
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
   * Suggested models, cheapest first — suggestions, never a whitelist.
   *
   * Vendors ship new models constantly, and a hardcoded list is stale the week
   * after it is written; the field these populate accepts anything typed into
   * it, so a model released tomorrow works today. **Aliases are preferred over
   * pinned versions** for exactly this reason: `opus` follows the latest Opus,
   * where `claude-opus-4` is a fact with an expiry date.
   *
   * Empty for OpenCode, whose models are whatever Ollama has pulled locally and
   * are discovered at runtime instead.
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
    // Aliases, which the CLI resolves to the current model of that name.
    models: [
      { id: 'haiku', label: 'Haiku', tier: 'fast' },
      { id: 'fable', label: 'Fable', tier: 'fast' },
      { id: 'sonnet', label: 'Sonnet', tier: 'balanced' },
      { id: 'opus', label: 'Opus', tier: 'deep' },
    ],
    // Straight from `claude --help`.
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    install: 'npm i -g @anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    dialect: 'codex',
    models: [
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', tier: 'fast' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', tier: 'balanced' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', tier: 'balanced' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', tier: 'deep' },
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
    defaultModel: 'kimi-k3',
    models: [
      { id: 'kimi-k2-turbo-preview', label: 'K2 Turbo', tier: 'fast' },
      { id: 'kimi-k3', label: 'K3', tier: 'deep' },
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
    defaultModel: 'gemini-3.7-flash',
    models: [
      { id: 'gemini-3.5-flash', label: '3.5 Flash', tier: 'fast' },
      { id: 'gemini-3.6-flash', label: '3.6 Flash', tier: 'balanced' },
      { id: 'gemini-3.7-flash', label: '3.7 Flash', tier: 'deep' },
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
    defaultModel: 'zhipuai/glm-5.3',
    models: [
      { id: 'zhipuai/glm-4.6', label: 'GLM 4.6', tier: 'fast' },
      { id: 'zhipuai/glm-5.2', label: 'GLM 5.2', tier: 'balanced' },
      { id: 'zhipuai/glm-5.3', label: 'GLM 5.3', tier: 'deep' },
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
    defaultModel: 'deepseek/deepseek-v4-pro',
    models: [
      { id: 'deepseek/deepseek-v4-flash', label: 'V4 Flash', tier: 'fast' },
      { id: 'deepseek/deepseek-v4-pro', label: 'V4 Pro', tier: 'deep' },
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
