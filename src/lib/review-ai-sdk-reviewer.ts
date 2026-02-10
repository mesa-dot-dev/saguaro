import type { Reviewer } from '../core/ports.js';
import { AgentExecutionError } from './errors.js';
import { type ResolvedModelConfig, resolveModelFromResolvedConfig } from './review-model-config.js';
import { runReviewAgent } from './review-runner.js';

export interface AiSdkReviewModelOptions {
  modelConfig: ResolvedModelConfig;
  maxSteps?: number;
  filesPerWorker?: number;
}

export function createAiSdkReviewModelAdapter(options: AiSdkReviewModelOptions): Reviewer {
  const model = resolveModelFromResolvedConfig(options.modelConfig);

  return {
    async review(input) {
      try {
        return await runReviewAgent({
          filesWithRules: input.filesWithRules,
          diffs: input.diffs ?? new Map(),
          model,
          filesPerWorker: options.filesPerWorker,
          verbose: input.verbose,
          codebaseContext: input.codebaseContext,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new AgentExecutionError(message, error);
      }
    },
  };
}
