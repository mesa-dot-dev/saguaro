/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import type { ReviewEngineOutcome } from '../core/review.js';
import type { ReviewRuntime } from '../lib/review-runtime.js';
import { runReview } from './review.js';

describe('runReview adapter translation', () => {
  test('translates reviewed skill outcome into rule-shaped result', async () => {
    const runtime: ReviewRuntime = {
      listChangedFiles: () => ['src/app.ts'],
      loadRules: () => ({
        rulesLoaded: 1,
        filesWithRules: new Map([
          [
            'src/app.ts',
            [
              {
                id: 'no-console-log',
                title: 'No console.log in production code',
                severity: 'warning',
                globs: ['**/*.ts'],
                instructions: 'Do not use console.log',
              },
            ],
          ],
        ]),
      }),
      createReviewer: () => ({
        review: async () => ({
          violations: [
            {
              ruleId: 'no-console-log',
              ruleTitle: 'No console.log in production code',
              severity: 'warning',
              file: 'src/app.ts',
              line: 10,
              message: 'console.log should not be used',
            },
          ],
          summary: {
            filesReviewed: 1,
            rulesChecked: 1,
            errors: 0,
            warnings: 1,
            infos: 0,
          },
        }),
      }),
    };

    const result = await runReview(
      {
        baseRef: 'main',
        headRef: 'HEAD',
      },
      runtime
    );

    const outcome: ReviewEngineOutcome = result.outcome;
    expect(outcome.kind).toBe('reviewed');
    if (outcome.kind !== 'reviewed') {
      throw new Error('Expected reviewed outcome');
    }

    expect(outcome.rulesLoaded).toBe(1);
    expect(outcome.filesWithRules).toBe(1);
    expect(outcome.totalChecks).toBe(1);
    expect(outcome.result.summary.rulesChecked).toBe(1);
    expect(outcome.result.violations[0]).toEqual({
      ruleId: 'no-console-log',
      ruleTitle: 'No console.log in production code',
      severity: 'warning',
      file: 'src/app.ts',
      line: 10,
      column: undefined,
      message: 'console.log should not be used',
      suggestion: undefined,
    });
  });

  test('translates no-matching-skills into no-matching-rules', async () => {
    const runtime: ReviewRuntime = {
      listChangedFiles: () => ['src/app.ts'],
      loadRules: () => ({
        rulesLoaded: 2,
        filesWithRules: new Map(),
      }),
      createReviewer: () => ({
        review: async () => ({
          violations: [],
          summary: {
            filesReviewed: 0,
            rulesChecked: 0,
            errors: 0,
            warnings: 0,
            infos: 0,
          },
        }),
      }),
    };

    const result = await runReview(
      {
        baseRef: 'main',
        headRef: 'HEAD',
      },
      runtime
    );

    expect(result.outcome.kind).toBe('no-matching-skills');
    if (result.outcome.kind !== 'no-matching-skills') {
      throw new Error('Expected no-matching-skills outcome');
    }
    expect(result.outcome.rulesLoaded).toBe(2);
    expect(result.outcome.filesWithRules).toBe(0);
  });
});
