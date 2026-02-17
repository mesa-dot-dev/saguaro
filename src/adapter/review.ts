import { createReviewCore, type ReviewEngineOutcome } from '../core/review.js';
import { getDiffs } from '../lib/git.js';
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
  /** Pre-computed diffs keyed by file path. Computed automatically from refs if omitted. */
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

  // Always ensure diffs are available — the review is meaningless without them
  const diffs = request.diffs ?? getDiffs(request.baseRef, request.headRef);

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
    diffs,
    onProgress: request.onProgress,
    abortSignal: request.abortSignal,
  });

  return {
    outcome,
  };
}
