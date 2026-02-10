import { minimatch } from 'minimatch';
import type { ReviewResult, Rule } from '../types/types.js';
import type { ClockPort, Reviewer, ReviewInputChannel, ReviewRequest } from './ports.js';

interface BaseReviewOutcome {
  changedFiles: string[];
  rulesLoaded: number;
  filesWithRules: number;
  totalChecks: number;
  durationMs: number;
}

export interface NoChangedFilesOutcome extends BaseReviewOutcome {
  kind: 'no-changed-files';
}

export interface NoMatchingRulesOutcome extends BaseReviewOutcome {
  kind: 'no-matching-rules';
}

export interface ReviewedOutcome extends BaseReviewOutcome {
  kind: 'reviewed';
  result: ReviewResult;
}

export type ReviewEngineOutcome = NoChangedFilesOutcome | NoMatchingRulesOutcome | ReviewedOutcome;

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

      const [changedFiles, rules] = await Promise.all([
        Promise.resolve(deps.input.listChangedFiles(request.baseRef, request.headRef)),
        Promise.resolve(deps.input.loadRules()),
      ]);

      if (changedFiles.length === 0) {
        return {
          kind: 'no-changed-files',
          changedFiles,
          rulesLoaded: rules.length,
          filesWithRules: 0,
          totalChecks: 0,
          durationMs: clock.nowMs() - startedAtMs,
        };
      }

      const filesWithRulesMap = selectRulesForFiles(changedFiles, rules);
      const totalChecks = Array.from(filesWithRulesMap.values()).reduce((acc, fileRules) => acc + fileRules.length, 0);

      if (filesWithRulesMap.size === 0) {
        return {
          kind: 'no-matching-rules',
          changedFiles,
          rulesLoaded: rules.length,
          filesWithRules: 0,
          totalChecks,
          durationMs: clock.nowMs() - startedAtMs,
        };
      }

      const reviewed = await deps.reviewer.review({
        baseRef: request.baseRef,
        headRef: request.headRef,
        filesWithRules: filesWithRulesMap,
        verbose: request.verbose,
        codebaseContext: request.codebaseContext,
        diffs: request.diffs,
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
        rulesLoaded: rules.length,
        filesWithRules: filesWithRulesMap.size,
        totalChecks,
        durationMs,
        result,
      };
    },
  };
}

function selectRulesForFiles(files: string[], rules: Rule[]): Map<string, Rule[]> {
  const fileRules = new Map<string, Rule[]>();

  for (const file of files) {
    const applicableRules = dedupeRulesById(
      rules.filter((rule) => {
        if (!rule.globs || rule.globs.length === 0) {
          return true;
        }

        let matched = false;
        let excluded = false;
        for (const glob of rule.globs) {
          if (glob.startsWith('!')) {
            if (minimatch(file, glob.slice(1))) {
              excluded = true;
            }
            continue;
          }

          if (minimatch(file, glob)) {
            matched = true;
          }
        }

        return matched && !excluded;
      })
    );

    if (applicableRules.length > 0) {
      fileRules.set(file, applicableRules);
    }
  }

  return fileRules;
}

function dedupeRulesById(rules: Rule[]): Rule[] {
  const seen = new Set<string>();
  const deduped: Rule[] = [];

  for (const rule of rules) {
    if (seen.has(rule.id)) {
      continue;
    }
    seen.add(rule.id);
    deduped.push(rule);
  }

  return deduped;
}
