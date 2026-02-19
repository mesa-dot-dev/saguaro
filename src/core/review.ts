import type { ReviewProgressCallback, ReviewResult, RulePolicy } from '../types/types.js';

export interface ReviewRequest {
  baseRef: string;
  headRef: string;
  verbose?: boolean;
  codebaseContext?: string;
  diffs?: Map<string, string>;
  onProgress?: ReviewProgressCallback;
  abortSignal?: AbortSignal;
}

export interface ReviewInputChannel {
  listChangedFiles(baseRef: string, headRef: string): Promise<string[]> | string[];
  loadRules(changedFiles: string[]):
    | Promise<{
        filesWithRules: Map<string, RulePolicy[]>;
        rulesLoaded: number;
      }>
    | {
        filesWithRules: Map<string, RulePolicy[]>;
        rulesLoaded: number;
      };
}

export interface ReviewerInput {
  baseRef: string;
  headRef: string;
  filesWithRules: Map<string, RulePolicy[]>;
  verbose?: boolean;
  codebaseContext?: string;
  diffs?: Map<string, string>;
  onProgress?: ReviewProgressCallback;
  abortSignal?: AbortSignal;
}

export interface Reviewer {
  review(input: ReviewerInput): Promise<ReviewResult>;
}

export interface ClockPort {
  nowMs(): number;
}

interface BaseReviewOutcome {
  changedFiles: string[];
  rulesLoaded: number;
  filesWithRules: number;
  totalChecks: number;
  durationMs: number;
  rulesEvaluated: string[];
}

export interface NoChangedFilesOutcome extends BaseReviewOutcome {
  kind: 'no-changed-files';
}

export interface NoMatchingSkillsOutcome extends BaseReviewOutcome {
  kind: 'no-matching-skills';
}

export interface ReviewedOutcome extends BaseReviewOutcome {
  kind: 'reviewed';
  result: ReviewResult;
}

export type ReviewEngineOutcome = NoChangedFilesOutcome | NoMatchingSkillsOutcome | ReviewedOutcome;

export interface ReviewCoreDeps {
  input: ReviewInputChannel;
  reviewer: Reviewer;
  clock?: ClockPort;
}

export interface ReviewCore {
  review(request: ReviewRequest): Promise<ReviewEngineOutcome>;
}

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
