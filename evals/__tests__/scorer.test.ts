import { describe, expect, test } from 'bun:test';
import type { ReviewResult, Violation } from '../../src/types/types';
import { scoreEval } from '../scorer';
import type { EvalRubric, FileExpectation } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeViolation(overrides: Partial<Violation> & Pick<Violation, 'ruleId' | 'file'>): Violation {
  return {
    ruleTitle: overrides.ruleId,
    severity: 'warning',
    line: undefined,
    column: undefined,
    message: `Violation for ${overrides.ruleId}`,
    suggestion: undefined,
    ...overrides,
  };
}

function makeRubric(overrides: Partial<EvalRubric> & { expectations: FileExpectation[] }): EvalRubric {
  return {
    id: 'test-rubric',
    description: 'Test rubric',
    category: 'basics',
    compare: { base: 'main', head: 'feature' },
    ...overrides,
  };
}

function makeResult(violations: Violation[]): ReviewResult {
  return {
    violations,
    summary: {
      filesReviewed: 1,
      rulesChecked: 1,
      errors: 0,
      warnings: violations.length,
      infos: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scoreEval', () => {
  test('perfect score — all shouldFire rules match, no extras', () => {
    const rubric = makeRubric({
      expectations: [
        { file: 'src/a.ts', shouldFire: [{ ruleId: 'no-console' }] },
        { file: 'src/b.ts', shouldFire: [{ ruleId: 'no-eval' }] },
      ],
    });

    const result = makeResult([
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts' }),
      makeViolation({ ruleId: 'no-eval', file: 'src/b.ts' }),
    ]);

    const { metrics } = scoreEval(rubric, result);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.f1).toBe(1);
    expect(metrics.fpRate).toBe(0);
  });

  test('false negative — shouldFire rule not found in violations', () => {
    const rubric = makeRubric({
      expectations: [{ file: 'src/a.ts', shouldFire: [{ ruleId: 'no-console' }] }],
    });

    const result = makeResult([]);

    const { metrics, details } = scoreEval(rubric, result);
    expect(metrics.recall).toBe(0);
    expect(metrics.precision).toBe(0);
    expect(details[0].falseNegatives).toHaveLength(1);
    expect(details[0].falseNegatives[0].ruleId).toBe('no-console');
  });

  test('false positive — mustNotFire rule fires', () => {
    const rubric = makeRubric({
      expectations: [
        {
          file: 'src/a.ts',
          shouldFire: [{ ruleId: 'no-console' }],
          mustNotFire: ['no-eval'],
        },
      ],
    });

    const result = makeResult([
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts' }),
      makeViolation({ ruleId: 'no-eval', file: 'src/a.ts' }),
    ]);

    const { metrics, details } = scoreEval(rubric, result);
    // TP=1, FP=1 => precision = 1/2 = 0.5
    expect(metrics.precision).toBe(0.5);
    expect(metrics.fpRate).toBeGreaterThan(0);
    expect(details[0].falsePositives).toHaveLength(1);
    expect(details[0].falsePositives[0].ruleId).toBe('no-eval');
  });

  test('undisciplined — violation with ruleId not in shouldFire or mustNotFire', () => {
    const rubric = makeRubric({
      expectations: [
        {
          file: 'src/a.ts',
          shouldFire: [{ ruleId: 'no-console' }],
          mustNotFire: ['no-eval'],
        },
      ],
    });

    const result = makeResult([
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts' }),
      makeViolation({ ruleId: 'unexpected-rule', file: 'src/a.ts' }),
    ]);

    const { metrics, details } = scoreEval(rubric, result);
    // TP=1, UD=1 => precision = 1/2 = 0.5
    expect(metrics.precision).toBe(0.5);
    expect(details[0].undisciplined).toHaveLength(1);
    expect(details[0].undisciplined[0].ruleId).toBe('unexpected-rule');
  });

  test('location accuracy — match within tolerance', () => {
    const rubric = makeRubric({
      expectations: [
        {
          file: 'src/a.ts',
          shouldFire: [{ ruleId: 'no-console', lineHint: 50 }],
        },
      ],
    });

    const result = makeResult([makeViolation({ ruleId: 'no-console', file: 'src/a.ts', line: 53 })]);

    const { metrics, details } = scoreEval(rubric, result);
    expect(metrics.locationAccuracy).toBe(1);
    expect(details[0].truePositives[0].lineMatched).toBe(true);
    expect(details[0].truePositives[0].expectedLine).toBe(50);
    expect(details[0].truePositives[0].actualLine).toBe(53);
  });

  test('location accuracy — miss outside tolerance', () => {
    const rubric = makeRubric({
      expectations: [
        {
          file: 'src/a.ts',
          shouldFire: [{ ruleId: 'no-console', lineHint: 50 }],
        },
      ],
    });

    const result = makeResult([makeViolation({ ruleId: 'no-console', file: 'src/a.ts', line: 60 })]);

    const { metrics, details } = scoreEval(rubric, result);
    expect(metrics.locationAccuracy).toBe(0);
    expect(details[0].truePositives[0].lineMatched).toBe(false);
  });

  test('empty scenario — no expectations, no violations, no division by zero', () => {
    const rubric = makeRubric({ expectations: [] });
    const result = makeResult([]);

    const { metrics, details } = scoreEval(rubric, result);
    expect(metrics.precision).toBe(0);
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBe(0);
    expect(metrics.locationAccuracy).toBe(0);
    expect(metrics.fpRate).toBe(0);
    expect(details).toHaveLength(0);
  });

  test('mixed multi-file — TP, FN, FP, UD across 3 files', () => {
    const rubric = makeRubric({
      expectations: [
        {
          file: 'src/a.ts',
          shouldFire: [{ ruleId: 'no-console' }, { ruleId: 'no-debugger' }],
          mustNotFire: ['no-eval'],
        },
        {
          file: 'src/b.ts',
          shouldFire: [{ ruleId: 'prefer-const' }],
        },
        {
          file: 'src/c.ts',
          shouldFire: [{ ruleId: 'no-var' }],
          mustNotFire: ['no-any'],
        },
      ],
    });

    const result = makeResult([
      // src/a.ts: no-console found (TP), no-debugger missing (FN), no-eval fires (FP)
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts' }),
      makeViolation({ ruleId: 'no-eval', file: 'src/a.ts' }),
      // src/b.ts: prefer-const found (TP), plus an extra (UD)
      makeViolation({ ruleId: 'prefer-const', file: 'src/b.ts' }),
      makeViolation({ ruleId: 'random-rule', file: 'src/b.ts' }),
      // src/c.ts: no-var found (TP), no-any NOT found (good)
      makeViolation({ ruleId: 'no-var', file: 'src/c.ts' }),
    ]);

    const { metrics, details } = scoreEval(rubric, result);

    // TP=3 (no-console, prefer-const, no-var)
    // FN=1 (no-debugger)
    // FP=1 (no-eval)
    // UD=1 (random-rule)
    // Precision = 3 / (3 + 1 + 1) = 0.6
    // Recall = 3 / (3 + 1) = 0.75
    // F1 = 2 * 0.6 * 0.75 / (0.6 + 0.75) = 0.9 / 1.35 = 2/3
    // fpRate = (1 + 1) / (4 shouldFire + 2 mustNotFire) = 2/6 = 1/3

    expect(metrics.precision).toBeCloseTo(0.6, 5);
    expect(metrics.recall).toBeCloseTo(0.75, 5);
    expect(metrics.f1).toBeCloseTo(2 / 3, 5);
    expect(metrics.fpRate).toBeCloseTo(1 / 3, 5);

    // Verify file-level details
    const fileA = details.find((d) => d.file === 'src/a.ts')!;
    expect(fileA.truePositives).toHaveLength(1);
    expect(fileA.falseNegatives).toHaveLength(1);
    expect(fileA.falsePositives).toHaveLength(1);

    const fileB = details.find((d) => d.file === 'src/b.ts')!;
    expect(fileB.truePositives).toHaveLength(1);
    expect(fileB.undisciplined).toHaveLength(1);

    const fileC = details.find((d) => d.file === 'src/c.ts')!;
    expect(fileC.truePositives).toHaveLength(1);
    expect(fileC.falsePositives).toHaveLength(0);
  });

  test('violations on unexpected files — categorized as undisciplined', () => {
    const rubric = makeRubric({
      expectations: [{ file: 'src/a.ts', shouldFire: [{ ruleId: 'no-console' }] }],
    });

    const result = makeResult([
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts' }),
      makeViolation({ ruleId: 'some-rule', file: 'src/unknown.ts' }),
      makeViolation({ ruleId: 'another-rule', file: 'src/unknown.ts' }),
    ]);

    const { metrics, details } = scoreEval(rubric, result);

    // TP=1, UD=2 => precision = 1/3
    expect(metrics.precision).toBeCloseTo(1 / 3, 5);
    expect(metrics.recall).toBe(1);

    // Unexpected file should appear in details
    const unknownFile = details.find((d) => d.file === 'src/unknown.ts')!;
    expect(unknownFile).toBeDefined();
    expect(unknownFile.undisciplined).toHaveLength(2);
    expect(unknownFile.truePositives).toHaveLength(0);
    expect(unknownFile.falseNegatives).toHaveLength(0);
    expect(unknownFile.falsePositives).toHaveLength(0);
  });

  test('lineHint proximity — prefers closest match when multiple expectations share ruleId', () => {
    const rubric = makeRubric({
      expectations: [
        {
          file: 'src/a.ts',
          shouldFire: [
            { ruleId: 'no-console', lineHint: 10 },
            { ruleId: 'no-console', lineHint: 50 },
          ],
        },
      ],
    });

    const result = makeResult([
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts', line: 48 }),
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts', line: 12 }),
    ]);

    const { metrics, details } = scoreEval(rubric, result);

    // Both should be TP
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(details[0].truePositives).toHaveLength(2);

    // Line 12 should match lineHint 10 (distance 2), line 48 should match lineHint 50 (distance 2)
    const tp1 = details[0].truePositives.find((m) => m.expectedLine === 10)!;
    expect(tp1.actualLine).toBe(12);
    expect(tp1.lineMatched).toBe(true);

    const tp2 = details[0].truePositives.find((m) => m.expectedLine === 50)!;
    expect(tp2.actualLine).toBe(48);
    expect(tp2.lineMatched).toBe(true);
  });

  test('lineHint proximity — falls back to first-match when no lineHints', () => {
    const rubric = makeRubric({
      expectations: [
        {
          file: 'src/a.ts',
          shouldFire: [{ ruleId: 'no-console' }, { ruleId: 'no-console' }],
        },
      ],
    });

    const result = makeResult([
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts', line: 10 }),
      makeViolation({ ruleId: 'no-console', file: 'src/a.ts', line: 50 }),
    ]);

    const { metrics } = scoreEval(rubric, result);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(1);
  });

  test('custom lineTolerance is respected', () => {
    const rubric = makeRubric({
      expectations: [
        {
          file: 'src/a.ts',
          shouldFire: [{ ruleId: 'no-console', lineHint: 50 }],
        },
      ],
    });

    const result = makeResult([makeViolation({ ruleId: 'no-console', file: 'src/a.ts', line: 60 })]);

    // Default tolerance=5 => line 60 is outside (|60-50|=10 > 5)
    const { metrics: m1 } = scoreEval(rubric, result);
    expect(m1.locationAccuracy).toBe(0);

    // Custom tolerance=10 => line 60 is within (|60-50|=10 <= 10)
    const { metrics: m2 } = scoreEval(rubric, result, 10);
    expect(m2.locationAccuracy).toBe(1);
  });
});
