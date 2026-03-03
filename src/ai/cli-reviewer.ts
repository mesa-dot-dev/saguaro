import type { AgentRunner } from '../core/types.js';
import type { ReviewProgressCallback, ReviewResult, RulePolicy } from '../types/types.js';
import { logger } from '../util/logger.js';
import { countRules, splitFilesForWorkers } from '../util/review-utils.js';
import { createClaudeCliRunner } from './agent-runner.js';
import { deduplicateViolations, parseViolationsDetailed } from './parser.js';
import { buildPrompt, SYSTEM_PROMPT } from './prompt.js';

export interface CliReviewOptions {
  filesWithRules: Map<string, RulePolicy[]>;
  diffs: Map<string, string>;
  cwd: string;
  filesPerWorker?: number;
  maxConcurrency?: number;
  maxTurns?: number;
  onProgress?: ReviewProgressCallback;
  codebaseContext?: string;
  abortSignal?: AbortSignal;
  model?: string;
  runner?: AgentRunner;
  /** Resolves a repo-relative file path to its content. Used for line snapping. */
  resolveFile?: (path: string) => string | null;
}

const DEFAULT_FILES_PER_WORKER = 3;
const DEFAULT_MAX_CONCURRENCY = 5;

export async function runCliReview(options: CliReviewOptions): Promise<ReviewResult> {
  const runStartedAtMs = Date.now();
  const runner = options.runner ?? createClaudeCliRunner();
  const filesPerWorker = options.filesPerWorker ?? DEFAULT_FILES_PER_WORKER;
  const fileGroups = splitFilesForWorkers(options.filesWithRules, filesPerWorker);
  const totalWorkers = fileGroups.length;

  const emitProgress: ReviewProgressCallback = (event) => {
    try {
      options.onProgress?.(event);
    } catch (err) {
      logger.debug(`[cli-review] Progress callback error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  logger.info(
    `[cli-review] Starting: ${options.filesWithRules.size} files, ${totalWorkers} workers (${filesPerWorker} files/worker)`
  );

  emitProgress({
    type: 'run_split',
    totalFiles: options.filesWithRules.size,
    totalWorkers,
  });

  const resolveFile = options.resolveFile ?? ((_path: string): string | null => null);

  let failedFiles = 0;

  const maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
  const workerResults = await mapWithConcurrency(fileGroups, maxConcurrency, async (group, index) => {
    const workerIndex = index + 1;
    const workerStartedAtMs = Date.now();

    const prompt = buildPrompt({
      diffs: options.diffs,
      filesWithRules: group,
      codebaseContext: options.codebaseContext,
    });

    logger.info(
      `[cli-review] Worker ${workerIndex}/${totalWorkers} starting (${group.size} files, ${prompt.length} prompt chars)`
    );

    emitProgress({
      type: 'worker_started',
      workerIndex,
      totalWorkers,
      promptChars: prompt.length,
    });

    try {
      const result = await runner.execute({
        systemPrompt: SYSTEM_PROMPT,
        prompt,
        cwd: options.cwd,
        allowedTools: ['Read'],
        model: options.model,
        maxTurns: options.maxTurns,
        abortSignal: options.abortSignal,
      });

      const workerDurationMs = Date.now() - workerStartedAtMs;
      const parsed = parseViolationsDetailed(result.output, group, resolveFile);

      logger.info(
        `[cli-review] Worker ${workerIndex}/${totalWorkers} done in ${(workerDurationMs / 1000).toFixed(1)}s — ${parsed.violations.length} violations (cli: ${(result.durationMs / 1000).toFixed(1)}s)`
      );

      emitProgress({
        type: 'worker_completed',
        workerIndex,
        totalWorkers,
        durationMs: workerDurationMs,
      });

      return parsed.violations;
    } catch (err) {
      const workerDurationMs = Date.now() - workerStartedAtMs;
      logger.error(
        `[cli-review] Worker ${workerIndex}/${totalWorkers} failed after ${(workerDurationMs / 1000).toFixed(1)}s: ${err instanceof Error ? err.message : String(err)}`
      );

      emitProgress({
        type: 'worker_completed',
        workerIndex,
        totalWorkers,
        durationMs: workerDurationMs,
      });

      failedFiles += group.size;
      return [];
    }
  });

  const allViolations = deduplicateViolations(workerResults.flat());
  const totalDurationMs = Date.now() - runStartedAtMs;

  if (failedFiles > 0) {
    logger.error(`[cli-review] ${failedFiles} files were not reviewed due to worker failures`);
  }

  logger.info(
    `[cli-review] Complete: ${allViolations.length} violations in ${(totalDurationMs / 1000).toFixed(1)}s (${totalWorkers} workers)`
  );

  emitProgress({
    type: 'run_summary',
    totalWorkers,
    totalToolCalls: 0,
    totalMatched: allViolations.length,
    totalIgnored: 0,
    totalViolations: allViolations.length,
    durationMs: totalDurationMs,
  });

  return {
    violations: allViolations,
    summary: {
      filesReviewed: options.filesWithRules.size - failedFiles,
      rulesChecked: countRules(options.filesWithRules),
      errors: allViolations.filter((v) => v.severity === 'error').length,
      warnings: allViolations.filter((v) => v.severity === 'warning').length,
      infos: allViolations.filter((v) => v.severity === 'info').length,
      failedFiles: failedFiles > 0 ? failedFiles : undefined,
    },
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
