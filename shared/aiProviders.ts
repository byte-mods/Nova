/**
 * The assistants Nova can drive, and how each one is reached.
 *
 * Three of these — Kimi, GLM and DeepSeek — are not separate CLIs. Each vendor
 * publishes an **Anthropic-compatible** endpoint intended to be driven by the
 * Claude Code CLI with `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` pointed
 * at it. So they run through the same binary, the same argument builder and the
 * same stream parser as Claude, with different environment.
 *
 * That is worth stating plainly because the alternative is tempting and wrong.
 * Writing three more adapters would mean three more JSON event formats to guess
 * at, each one untestable without a paid key, each one silently drifting when a
 * vendor changes a field. Reusing the Claude path means these providers inherit
 * a parser that is already exercised by the test suite, and the only new thing
 * that can break is the two environment variables — which the settings page
 * shows the user directly.
 *
 * The base URLs are defaults, not constants. They are vendor endpoints that can
 * move, so every one is editable in Settings; if a vendor changes an address,
 * the user changes a field rather than waiting for a release.
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
  dialect: 'claude' | 'codex' | 'opencode'
  /** Set when this provider is a vendor endpoint driven through another CLI. */
  compatible?: {
    /** Where to send requests, unless the user overrides it. */
    defaultBaseUrl: string
    /** Env var carrying the endpoint. */
    baseUrlEnv: string
    /** Env var carrying the credential. */
    tokenEnv: string
    /** Suggested model id, shown as the placeholder in Settings. */
    defaultModel: string
    /** Where the user gets a key. */
    console: string
  }
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
    binary: 'claude',
    dialect: 'claude',
    compatible: {
      defaultBaseUrl: 'https://api.moonshot.ai/anthropic',
      baseUrlEnv: 'ANTHROPIC_BASE_URL',
      tokenEnv: 'ANTHROPIC_AUTH_TOKEN',
      defaultModel: 'kimi-k2-turbo-preview',
      console: 'https://platform.moonshot.ai/console/api-keys',
    },
    install: 'Needs the Claude Code CLI plus a Moonshot API key in Settings › AI',
  },
  {
    id: 'glm',
    label: 'GLM (Z.ai)',
    binary: 'claude',
    dialect: 'claude',
    compatible: {
      defaultBaseUrl: 'https://api.z.ai/api/anthropic',
      baseUrlEnv: 'ANTHROPIC_BASE_URL',
      tokenEnv: 'ANTHROPIC_AUTH_TOKEN',
      defaultModel: 'glm-4.6',
      console: 'https://z.ai/manage-apikey/apikey-list',
    },
    install: 'Needs the Claude Code CLI plus a Z.ai API key in Settings › AI',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    binary: 'claude',
    dialect: 'claude',
    compatible: {
      defaultBaseUrl: 'https://api.deepseek.com/anthropic',
      baseUrlEnv: 'ANTHROPIC_BASE_URL',
      tokenEnv: 'ANTHROPIC_AUTH_TOKEN',
      defaultModel: 'deepseek-chat',
      console: 'https://platform.deepseek.com/api_keys',
    },
    install: 'Needs the Claude Code CLI plus a DeepSeek API key in Settings › AI',
  },
]

export function providerSpec(id: AiProvider): AiProviderSpec {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0]
}

/** Providers reached through another vendor's CLI, which need a key. */
export function compatibleProviders(): AiProviderSpec[] {
  return AI_PROVIDERS.filter((p) => p.compatible)
}
