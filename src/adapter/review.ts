import { createReviewCore, type ReviewEngineOutcome } from '../core/review-engine.js';
import { AgentExecutionError } from '../lib/errors.js';
import { listChangedFilesFromGit } from '../lib/git.js';
import { createAiSdkReviewModelAdapter } from '../lib/review-ai-sdk-reviewer.js';
import { loadReviewAdapterConfig } from '../lib/review-model-config.js';
import { loadConfiguredRules } from '../lib/rules.js';

export interface ReviewAdapterRequest {
  baseRef: string;
  headRef: string;
  rulesDir?: string;
  verbose?: boolean;
  configPath?: string;
  /** Markdown section with import graph + blast radius context from the codebase indexer */
  codebaseContext?: string;
  /** Pre-computed diffs keyed by file path */
  diffs?: Map<string, string>;
}

export interface ReviewAdapterResult {
  outcome: ReviewEngineOutcome;
}

export async function runReviewAdapter(request: ReviewAdapterRequest): Promise<ReviewAdapterResult> {
  const resolvedConfig = loadReviewAdapterConfig(request.configPath);

  const reviewCore = createReviewCore({
    input: {
      listChangedFiles: (base, head) => listChangedFilesFromGit(base, head),
      loadRules: () => loadConfiguredRules(request.rulesDir),
    },
    reviewer: createAiSdkReviewModelAdapter({
      modelConfig: resolvedConfig.modelConfig,
      maxSteps: resolvedConfig.maxSteps,
      filesPerWorker: resolvedConfig.filesPerWorker,
    }),
  });

  const outcome = await reviewCore.review({
    baseRef: request.baseRef,
    headRef: request.headRef,
    verbose: request.verbose,
    codebaseContext: request.codebaseContext,
    diffs: request.diffs,
  });

  return {
    outcome,
  };
}

export function isReviewAdapterExecutionError(error: unknown): error is AgentExecutionError {
  return error instanceof AgentExecutionError;
}
