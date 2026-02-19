import { createReviewCore, type ReviewEngineOutcome } from '../core/review.js';
import { getDiffs } from '../lib/git.js';
import { appendReviewEntry } from '../lib/history.js';
import { createNodeReviewRuntime, type ReviewRuntime } from '../lib/review-runtime.js';
import type { ReviewProgressCallback } from '../types/types.js';

export interface ReviewAdapterRequest {
  baseRef: string;
  headRef: string;
  changedFilesOverride?: string[];
  rulesDir?: string;
  verbose?: boolean;
  configPath?: string;
  codebaseContext?: string;
  diffs?: Map<string, string>;
  onProgress?: ReviewProgressCallback;
  abortSignal?: AbortSignal;
  source?: 'cli' | 'hook' | 'mcp';
}

export interface ReviewAdapterResult {
  outcome: ReviewEngineOutcome;
}

export async function runReview(request: ReviewAdapterRequest, runtime?: ReviewRuntime): Promise<ReviewAdapterResult> {
  const effectiveRuntime = runtime ?? createNodeReviewRuntime({ rulesDir: request.rulesDir });
  const changedFilesOverride = request.changedFilesOverride;
  const diffs = request.diffs ?? getDiffs(request.baseRef, request.headRef);

  const { reviewer, modelInfo } = effectiveRuntime.createReviewer(request.configPath);

  const reviewCore = createReviewCore({
    input: {
      listChangedFiles: (base, head) => changedFilesOverride ?? effectiveRuntime.listChangedFiles(base, head),
      loadRules: (changedFiles) => effectiveRuntime.loadRules(changedFiles),
    },
    reviewer,
  });

  const outcome = await reviewCore.review({
    baseRef: request.baseRef,
    headRef: request.headRef,
    verbose: request.verbose,
    codebaseContext: request.codebaseContext,
    diffs,
    onProgress: request.onProgress,
    abortSignal: request.abortSignal,
  });

  if (outcome.kind === 'reviewed') {
    try {
      appendReviewEntry({
        timestamp: new Date().toISOString(),
        source: request.source ?? 'cli',
        baseRef: request.baseRef,
        headRef: request.headRef,
        provider: modelInfo.provider,
        model: modelInfo.model,
        rulesEvaluated: outcome.rulesEvaluated,
        result: outcome.result,
      });
    } catch {
      // Never let history recording break the review flow
    }
  }

  return {
    outcome,
  };
}
