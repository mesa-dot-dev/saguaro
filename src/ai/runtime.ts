import type { ModelProvider, SaguaroConfig } from '../config/model-config.js';
import { loadValidatedConfig, resolveModelForReview } from '../config/model-config.js';
import type { AgentRunner, ModelInfo, Reviewer, ReviewRuntime } from '../core/types.js';
import { getFileAtRef, getRepoRoot, listChangedFilesFromGit } from '../git/git.js';
import { resolveRulesForFiles } from '../rules/resolution.js';
import { ConfigMissingError } from '../util/errors.js';
import {
  createClaudeCliRunner,
  createCodexCliRunner,
  createGeminiCliRunner,
  isCliAuthenticated,
} from './agent-runner.js';
import { runCliReview } from './cli-reviewer.js';

export function createNodeReviewRuntime(options?: { rulesDir?: string }): ReviewRuntime {
  return {
    listChangedFiles(baseRef, headRef) {
      return listChangedFilesFromGit(baseRef, headRef);
    },
    loadRules(changedFiles) {
      return resolveRulesForFiles(changedFiles, { explicitRulesDir: options?.rulesDir });
    },
    createReviewer(configPath) {
      let config: SaguaroConfig | undefined;
      try {
        config = loadValidatedConfig(configPath);
      } catch (error) {
        if (error instanceof ConfigMissingError) {
          return createCliReviewer();
        }
        throw error;
      }

      const provider = config.model.provider;
      const model = resolveModelForReview(config, 'rules');
      const runner = resolveCliRunner(provider);

      return createCliReviewer(config, runner, model);
    },
  };
}

function createGitFileResolver(ref: string): (filePath: string) => string | null {
  const cache = new Map<string, string | null>();
  return (filePath: string) => {
    if (cache.has(filePath)) return cache.get(filePath)!;
    const content = getFileAtRef(ref, filePath);
    cache.set(filePath, content);
    return content;
  };
}

function resolveCliRunner(provider: ModelProvider): AgentRunner {
  switch (provider) {
    case 'anthropic':
      return createClaudeCliRunner();
    case 'openai': {
      if (!isCliAuthenticated('codex')) {
        throw new Error('OpenAI models require the Codex CLI. Install it from https://github.com/openai/codex');
      }
      return createCodexCliRunner();
    }
    case 'google': {
      if (!isCliAuthenticated('gemini')) {
        throw new Error(
          'Google models require the Gemini CLI. Install it from https://github.com/google-gemini/gemini-cli'
        );
      }
      return createGeminiCliRunner();
    }
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
  }
}

function createCliReviewer(
  config?: SaguaroConfig,
  runner?: AgentRunner,
  modelOverride?: string
): { reviewer: Reviewer; modelInfo: ModelInfo } {
  const provider = config?.model.provider ?? 'anthropic';
  const modelName = modelOverride ?? config?.model.name ?? 'default';
  const model = modelName === 'default' ? undefined : modelName;
  return {
    modelInfo: { provider, model: modelName },
    reviewer: {
      async review(input) {
        const result = await runCliReview({
          filesWithRules: input.filesWithRules,
          diffs: input.diffs ?? new Map(),
          cwd: getRepoRoot(),
          filesPerWorker: config?.review.files_per_batch,
          maxTurns: config?.review.max_steps,
          codebaseContext: input.codebaseContext,
          onProgress: input.onProgress,
          abortSignal: input.abortSignal,
          model,
          runner,
          resolveFile: createGitFileResolver(input.headRef),
        });
        return {
          violations: result.violations,
          summary: { ...result.summary, provider, model: modelName },
        };
      },
    },
  };
}
