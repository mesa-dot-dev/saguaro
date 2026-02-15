import { createReviewCore, type ReviewEngineOutcome } from '../core/review.js';
import { createNodeReviewRuntime, type ReviewRuntime } from '../lib/review-runtime.js';
import type { ReviewProgressCallback } from '../types/types.js';

export interface ReviewAdapterRequest {
  baseRef: string;
  headRef: string;
  changedFilesOverride?: string[];
  rulesDir?: string;
  verbose?: boolean;
  configPath?: string;
  /** Markdown section with import graph + blast radius context from the codebase indexer */
  codebaseContext?: string;
  /** Pre-computed diffs keyed by file path */
  diffs?: Map<string, string>;
  onProgress?: ReviewProgressCallback;
  abortSignal?: AbortSignal;
}

export interface ReviewAdapterResult {
  outcome: ReviewEngineOutcome;
}

export async function runReview(request: ReviewAdapterRequest, runtime?: ReviewRuntime): Promise<ReviewAdapterResult> {
  const effectiveRuntime = runtime ?? createNodeReviewRuntime();
  const changedFilesOverride = request.changedFilesOverride;

  const reviewCore = createReviewCore({
    input: {
      listChangedFiles: (base, head) => changedFilesOverride ?? effectiveRuntime.listChangedFiles(base, head),
      loadRules: (changedFiles) => effectiveRuntime.loadRules(changedFiles, request.rulesDir),
    },
    reviewer: effectiveRuntime.createReviewer(request.configPath),
  });

  const outcome = await reviewCore.review({
    baseRef: request.baseRef,
    headRef: request.headRef,
    verbose: request.verbose,
    codebaseContext: request.codebaseContext,
    diffs: request.diffs,
    onProgress: request.onProgress,
    abortSignal: request.abortSignal,
  });

  return {
    outcome,
  };
}
