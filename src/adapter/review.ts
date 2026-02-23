import path from 'node:path';
import { createReviewCore } from '../core/review.js';
import type { ReviewEngineOutcome } from '../core/types.js';
import { getCodebaseContext } from '../indexer/index.js';
import { getDiffs, getRepoRoot, listChangedFilesFromGit } from '../lib/git.js';
import { appendReviewEntry } from '../lib/history.js';
import { loadValidatedConfig } from '../lib/review-model-config.js';
import { createNodeReviewRuntime, type ReviewRuntime } from '../lib/review-runtime.js';
import type { ReviewProgressCallback } from '../types/types.js';

export interface ReviewAdapterRequest {
  baseRef: string;
  headRef: string;
  changedFilesOverride?: string[];
  rulesDir?: string;
  verbose?: boolean;
  configPath?: string;
  /** Pre-computed codebase context. Computed automatically from config + changed files if omitted. */
  codebaseContext?: string;
  /** Pre-computed diffs keyed by file path. Computed automatically from refs if omitted. */
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

  // Compute codebase context if not provided and indexing is enabled
  let codebaseContext = request.codebaseContext;
  if (codebaseContext === undefined) {
    codebaseContext = await resolveCodebaseContext({
      baseRef: request.baseRef,
      headRef: request.headRef,
      configPath: request.configPath,
      changedFilesOverride,
      verbose: request.verbose,
    });
  }

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
    codebaseContext,
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

async function resolveCodebaseContext(options: {
  baseRef: string;
  headRef: string;
  configPath?: string;
  changedFilesOverride?: string[];
  verbose?: boolean;
}): Promise<string> {
  try {
    const config = loadValidatedConfig(options.configPath);
    if (!config.index.enabled) return '';

    const changedFiles = options.changedFilesOverride ?? listChangedFilesFromGit(options.baseRef, options.headRef);
    if (changedFiles.length === 0) return '';

    const repoRoot = getRepoRoot();
    return await getCodebaseContext({
      rootDir: repoRoot,
      cacheDir: path.join(repoRoot, '.mesa', 'cache'),
      changedFiles,
      blastRadiusDepth: config.index.blast_radius_depth,
      tokenBudget: config.index.context_token_budget,
      verbose: options.verbose,
    });
  } catch {
    // Codebase context is best-effort — never block a review
    return '';
  }
}
