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
  /** Shown in Settings when the provider is not usable yet. */
  install: string
}

export const AI_PROVIDERS: AiProviderSpec[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    dialect: 'claude',
    install: 'npm i -g @anthropic-ai/claude-code',
  },
  {
    id: 'codex',
    label: 'Codex',
    binary: 'codex',
    dialect: 'codex',
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
