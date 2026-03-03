import type { AgentRunner, ModelInfo, Reviewer, ReviewRuntime } from '../core/types.js';
import { createCodexCliRunner, createGeminiCliRunner, isCliAuthenticated } from './agent-runner.js';
import { runCliReview } from './cli-review-runner.js';
import { AgentExecutionError, ConfigMissingError } from './errors.js';
import { getFileAtRef, getRepoRoot, listChangedFilesFromGit } from './git.js';
import type { MesaConfig } from './review-model-config.js';
import { loadValidatedConfig, resolveApiKey, resolveModelFromResolvedConfig } from './review-model-config.js';
import { runReviewAgent } from './review-runner.js';
import { resolveRulesForFiles } from './rule-resolution.js';

export function createNodeReviewRuntime(options?: { rulesDir?: string }): ReviewRuntime {
  return {
    listChangedFiles(baseRef, headRef) {
      return listChangedFilesFromGit(baseRef, headRef);
    },
    loadRules(changedFiles) {
      return resolveRulesForFiles(changedFiles, { explicitRulesDir: options?.rulesDir });
    },
    createReviewer(configPath) {
      // Try loading config. If missing, default to CLI runner.
      let config: MesaConfig | undefined;
      try {
        config = loadValidatedConfig(configPath);
      } catch (error) {
        if (error instanceof ConfigMissingError) {
          return createCliReviewer();
        }
        throw error;
      }

      // Route by provider: prefer CLI runners, fall back to SDK
      if (config.model.provider === 'anthropic') {
        return createCliReviewer(config);
      }

      if (config.model.provider === 'openai' && isCliAuthenticated('codex')) {
        return createCliReviewer(config, createCodexCliRunner());
      }

      if (config.model.provider === 'google' && isCliAuthenticated('gemini')) {
        return createCliReviewer(config, createGeminiCliRunner());
      }

      return createSdkReviewer(config);
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

function createCliReviewer(config?: MesaConfig, runner?: AgentRunner): { reviewer: Reviewer; modelInfo: ModelInfo } {
  const provider = config?.model.provider ?? 'anthropic';
  const modelName = config?.model.name ?? 'default';
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

function createSdkReviewer(config: MesaConfig): { reviewer: Reviewer; modelInfo: ModelInfo } {
  const apiKey = resolveApiKey(config);
  const modelConfig = { provider: config.model.provider, model: config.model.name, apiKey };
  const model = resolveModelFromResolvedConfig(modelConfig);

  return {
    modelInfo: { provider: modelConfig.provider, model: modelConfig.model },
    reviewer: {
      async review(input) {
        try {
          const result = await runReviewAgent({
            filesWithRules: input.filesWithRules,
            diffs: input.diffs ?? new Map(),
            model,
            filesPerWorker: config.review.files_per_batch,
            maxSteps: config.review.max_steps,
            verbose: input.verbose,
            codebaseContext: input.codebaseContext,
            onProgress: input.onProgress,
            resolveFile: createGitFileResolver(input.headRef),
            abortSignal: input.abortSignal,
            modelId: modelConfig.model,
          });
          return {
            violations: result.violations,
            summary: { ...result.summary, provider: modelConfig.provider, model: modelConfig.model },
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new AgentExecutionError(message, error);
        }
      },
    },
  };
}
