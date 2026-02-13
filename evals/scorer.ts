import type { ReviewResult, Violation } from '../src/types/types';
import type { EvalMetrics, EvalRubric, FileResult, ViolationMatch } from './types';

const DEFAULT_LINE_TOLERANCE = 5;

export function scoreEval(
  rubric: EvalRubric,
  result: ReviewResult,
  lineTolerance: number = DEFAULT_LINE_TOLERANCE
): { metrics: EvalMetrics; details: FileResult[] } {
  const violationsByFile = groupViolationsByFile(result.violations);
  const details: FileResult[] = [];
  const expectedFiles = new Set<string>();

  // Process each file expectation
  for (const expectation of rubric.expectations) {
    expectedFiles.add(expectation.file);
    const fileViolations = violationsByFile.get(expectation.file) ?? [];
    const consumedIndices = new Set<number>();
    const fileResult: FileResult = {
      file: expectation.file,
      truePositives: [],
      falseNegatives: [],
      falsePositives: [],
      undisciplined: [],
    };

    // Match shouldFire expectations — prefer lineHint proximity when multiple share ruleId
    for (const expected of expectation.shouldFire) {
      let bestIdx = -1;
      let bestDistance = Infinity;

      for (let i = 0; i < fileViolations.length; i++) {
        if (consumedIndices.has(i)) continue;
        if (fileViolations[i].ruleId !== expected.ruleId) continue;

        if (expected.lineHint != null && fileViolations[i].line != null) {
          const distance = Math.abs(fileViolations[i].line! - expected.lineHint);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIdx = i;
          }
        } else if (bestIdx === -1) {
          // No lineHint or no line on violation — take first available match
          bestIdx = i;
        }
      }

      if (bestIdx !== -1) {
        consumedIndices.add(bestIdx);
        const actual = fileViolations[bestIdx];
        const match: ViolationMatch = {
          kind: 'true-positive',
          file: expectation.file,
          ruleId: expected.ruleId,
        };

        if (expected.lineHint != null) {
          match.expectedLine = expected.lineHint;
          match.actualLine = actual.line ?? undefined;
          match.lineMatched = actual.line != null && Math.abs(actual.line - expected.lineHint) <= lineTolerance;
        }

        fileResult.truePositives.push(match);
      } else {
        fileResult.falseNegatives.push({
          kind: 'false-negative',
          file: expectation.file,
          ruleId: expected.ruleId,
          expectedLine: expected.lineHint,
        });
      }
    }

    // Check mustNotFire
    const mustNotFire = expectation.mustNotFire ?? [];
    const mustNotFireSet = new Set(mustNotFire.map((e) => (typeof e === 'string' ? e : e.ruleId)));
    for (let i = 0; i < fileViolations.length; i++) {
      if (consumedIndices.has(i)) continue;
      const v = fileViolations[i];
      if (mustNotFireSet.has(v.ruleId)) {
        consumedIndices.add(i);
        fileResult.falsePositives.push({
          kind: 'false-positive',
          file: expectation.file,
          ruleId: v.ruleId,
          actualLine: v.line ?? undefined,
        });
      }
    }

    // Remaining violations are undisciplined
    for (let i = 0; i < fileViolations.length; i++) {
      if (consumedIndices.has(i)) continue;
      const v = fileViolations[i];
      fileResult.undisciplined.push({
        kind: 'undisciplined',
        file: expectation.file,
        ruleId: v.ruleId,
        actualLine: v.line ?? undefined,
      });
    }

    details.push(fileResult);
  }

  // Violations on files not in any expectation
  for (const [file, violations] of violationsByFile) {
    if (expectedFiles.has(file)) continue;
    const fileResult: FileResult = {
      file,
      truePositives: [],
      falseNegatives: [],
      falsePositives: [],
      undisciplined: violations.map((v) => ({
        kind: 'undisciplined' as const,
        file,
        ruleId: v.ruleId,
        actualLine: v.line ?? undefined,
      })),
    };
    details.push(fileResult);
  }

  // Compute aggregate metrics
  const metrics = computeMetrics(rubric, details);

  return { metrics, details };
}

function groupViolationsByFile(violations: Violation[]): Map<string, Violation[]> {
  const map = new Map<string, Violation[]>();
  for (const v of violations) {
    const arr = map.get(v.file);
    if (arr) {
      arr.push(v);
    } else {
      map.set(v.file, [v]);
    }
  }
  return map;
}

function computeMetrics(rubric: EvalRubric, details: FileResult[]): EvalMetrics {
  let tp = 0;
  let fn = 0;
  let fp = 0;
  let ud = 0;
  let lineHintCount = 0;
  let lineMatchedCount = 0;

  for (const file of details) {
    tp += file.truePositives.length;
    fn += file.falseNegatives.length;
    fp += file.falsePositives.length;
    ud += file.undisciplined.length;

    for (const match of file.truePositives) {
      if (match.expectedLine != null) {
        lineHintCount++;
        if (match.lineMatched) {
          lineMatchedCount++;
        }
      }
    }
  }

  const precisionDenom = tp + fp + ud;
  const recallDenom = tp + fn;
  const precision = precisionDenom > 0 ? tp / precisionDenom : 0;
  const recall = recallDenom > 0 ? tp / recallDenom : 0;
  const f1Denom = precision + recall;
  const f1 = f1Denom > 0 ? (2 * precision * recall) / f1Denom : 0;
  const locationAccuracy = lineHintCount > 0 ? lineMatchedCount / lineHintCount : 0;

  let totalShouldFire = 0;
  let totalMustNotFire = 0;
  for (const exp of rubric.expectations) {
    totalShouldFire += exp.shouldFire.length;
    totalMustNotFire += (exp.mustNotFire ?? []).length;
  }
  const fpRateDenom = totalShouldFire + totalMustNotFire;
  const fpRate = fpRateDenom > 0 ? (fp + ud) / fpRateDenom : 0;

  return { precision, recall, f1, locationAccuracy, fpRate };
}
