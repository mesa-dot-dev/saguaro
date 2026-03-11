import type { ModelProvider } from './model-config.js';

/**
 * Default model aliases/IDs used when a CLI is detected during init.
 * These are passed as `model.name` in config.yaml.
 *
 * - anthropic: 'sonnet' is a Claude Code alias that resolves to the latest Sonnet.
 * - openai/google: 'default' means no --model flag is passed, so the CLI uses its own default.
 */
export const CLI_DEFAULT_MODELS: Record<ModelProvider, string> = {
  anthropic: 'sonnet',
  openai: 'default',
  google: 'default',
};

export interface ConfigOptions {
  provider: ModelProvider;
  model: string;
  daemon: boolean;
}

export function buildConfigContent(opts: ConfigOptions): string {
  let content = `# Saguaro Configuration
# =============================================================================
# Model Configuration
# =============================================================================
# The AI provider and default model for all reviews.
# The provider determines which CLI harness is used (claude, codex, gemini).
# You can use a CLI alias (e.g. "sonnet", "opus") which resolves to the
# latest version, or a specific model ID (e.g. "claude-sonnet-4-6").

model:
  provider: ${opts.provider}
  name: ${opts.model}

# =============================================================================
# Output Configuration
# =============================================================================

output:
  # Print Cursor deeplink when violations are found
  cursor_deeplink: true

# =============================================================================
# Review Settings
# =============================================================================

review:
  # Maximum tool-calling steps per review batch
  max_steps: 10

  # Optional per-review-kind model overrides (defaults to model.name above)
  # rules:
  #   model: claude-sonnet-4-6
  # classic:
  #   model: claude-sonnet-4-6

# =============================================================================
# Hook Settings
# =============================================================================

hook:
  # Master switch for all Saguaro hooks (PreToolUse rule injection + stop hook reviews)
  enabled: true

  # Rules review: runs after each code change, evaluates diffs against .saguaro/rules/*.md,
  # and blocks the agent until all violations are fixed (fix-loop).
  stop:
    enabled: true
`;

  if (opts.daemon) {
    content += `
# =============================================================================
# Background Reviews (Classic)
# =============================================================================
# Runs a senior-engineer-style review asynchronously in the background.
# Findings are advisory and surfaced on the next agent turn.
# Independent of the rules review above — both can run together.

daemon:
  enabled: true
  # Optional model override for background reviews (defaults to model.name above)
  # model: claude-sonnet-4-6
`;
  }

  return content;
}
