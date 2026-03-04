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
  let content = `# Mesa Configuration
# =============================================================================
# Model Configuration
# =============================================================================
# The AI model to use for reviews. Set API keys in your environment
# (.env.local, .env, or shell export).

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

# =============================================================================
# Hook Settings
# =============================================================================

hook:
  # Master switch for all Mesa hooks
  enabled: true

  # Stop hook: full LLM review after Claude finishes writing code
  # The PreToolUse hook injects rules proactively, so this is opt-in
  stop:
    enabled: false
`;

  if (opts.daemon) {
    content += `
# =============================================================================
# Background Reviews
# =============================================================================
# Automatically reviews your changes as you code and reports findings
# before you finish. No extra setup required.

daemon:
  enabled: true
`;
  }

  return content;
}
