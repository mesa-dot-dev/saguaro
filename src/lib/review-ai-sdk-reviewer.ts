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
          baseBranch: input.baseRef,
          headRef: input.headRef,
          filesWithRules: input.filesWithRules,
          model,
          maxSteps: options.maxSteps,
          filesPerWorker: options.filesPerWorker,
          verbose: input.verbose,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new AgentExecutionError(message, error);
      }
    },
  };
}
