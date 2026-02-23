import type { ClockPort, ReviewCore, ReviewCoreDeps, ReviewEngineOutcome, ReviewRequest } from './types.js';

// Re-export all core types so consumers can import from either core/review.js or core/types.js
export type {
  ClockPort,
  NoChangedFilesOutcome,
  NoMatchingSkillsOutcome,
  ReviewCore,
  ReviewCoreDeps,
  ReviewEngineOutcome,
  ReviewedOutcome,
  Reviewer,
  ReviewerInput,
  ReviewInputChannel,
  ReviewRequest,
} from './types.js';

const DEFAULT_CLOCK: ClockPort = {
  nowMs: () => Date.now(),
};

export function createReviewCore(deps: ReviewCoreDeps): ReviewCore {
  const clock = deps.clock ?? DEFAULT_CLOCK;

  return {
    async review(request: ReviewRequest): Promise<ReviewEngineOutcome> {
      const startedAtMs = clock.nowMs();

      const changedFiles = await Promise.resolve(deps.input.listChangedFiles(request.baseRef, request.headRef));

      const rulesResolution = await Promise.resolve(deps.input.loadRules(changedFiles));

      if (changedFiles.length === 0) {
        return {
          kind: 'no-changed-files',
          changedFiles,
          rulesLoaded: rulesResolution.rulesLoaded,
          filesWithRules: 0,
          totalChecks: 0,
          durationMs: clock.nowMs() - startedAtMs,
          rulesEvaluated: [],
        };
      }

      const filesWithRulesMap = rulesResolution.filesWithRules;
      const totalChecks = Array.from(filesWithRulesMap.values()).reduce((acc, fileRules) => acc + fileRules.length, 0);
      const rulesEvaluated = [
        ...new Set(Array.from(filesWithRulesMap.values()).flatMap((rules) => rules.map((r) => r.id))),
      ];

      if (filesWithRulesMap.size === 0) {
        return {
          kind: 'no-matching-skills',
          changedFiles,
          rulesLoaded: rulesResolution.rulesLoaded,
          filesWithRules: 0,
          totalChecks,
          durationMs: clock.nowMs() - startedAtMs,
          rulesEvaluated,
        };
      }

      const reviewed = await deps.reviewer.review({
        baseRef: request.baseRef,
        headRef: request.headRef,
        filesWithRules: filesWithRulesMap,
        verbose: request.verbose,
        codebaseContext: request.codebaseContext,
        diffs: request.diffs,
        onProgress: request.onProgress,
        abortSignal: request.abortSignal,
      });

      const durationMs = clock.nowMs() - startedAtMs;
      const result = {
        ...reviewed,
        summary: {
          ...reviewed.summary,
          durationMs,
        },
      };

      return {
        kind: 'reviewed',
        changedFiles,
        rulesLoaded: rulesResolution.rulesLoaded,
        filesWithRules: filesWithRulesMap.size,
        totalChecks,
        durationMs,
        rulesEvaluated,
        result,
      };
    },
  };
}
