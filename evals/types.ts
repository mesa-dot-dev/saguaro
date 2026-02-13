import { z } from 'zod';

// ---------------------------------------------------------------------------
// Rubric schemas (Zod-validated input)
// ---------------------------------------------------------------------------

export const RuleExpectationSchema = z.object({
  ruleId: z.string(),
  lineHint: z.number().optional(),
  description: z.string().optional(),
});

export const FileExpectationSchema = z.object({
  file: z.string(),
  shouldFire: z.array(RuleExpectationSchema),
  mustNotFire: z
    .array(
      z.union([
        z.string(),
        z.object({
          ruleId: z.string(),
          lineHint: z.number().optional(),
          description: z.string().optional(),
        }),
      ])
    )
    .optional(),
  notes: z.string().optional(),
});

export const EvalRubricSchema = z.object({
  id: z.string(),
  description: z.string(),
  category: z.enum(['basics', 'discipline', 'context-awareness', 'cross-file', 'noise-resilience']),
  compare: z.object({
    base: z.string(),
    head: z.string(),
  }),
  expectations: z.array(FileExpectationSchema),
});

export type RuleExpectation = z.infer<typeof RuleExpectationSchema>;
export type FileExpectation = z.infer<typeof FileExpectationSchema>;
export type EvalRubric = z.infer<typeof EvalRubricSchema>;

// ---------------------------------------------------------------------------
// Scorer output types
// ---------------------------------------------------------------------------

export type MatchKind = 'true-positive' | 'false-negative' | 'false-positive' | 'undisciplined';

export interface ViolationMatch {
  kind: MatchKind;
  file: string;
  ruleId: string;
  lineMatched?: boolean;
  actualLine?: number;
  expectedLine?: number;
}

export interface FileResult {
  file: string;
  truePositives: ViolationMatch[];
  falseNegatives: ViolationMatch[];
  falsePositives: ViolationMatch[];
  undisciplined: ViolationMatch[];
}

export interface EvalMetrics {
  precision: number;
  recall: number;
  f1: number;
  locationAccuracy: number;
  fpRate: number;
}

export interface EvalCost {
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface EvalResult {
  rubricId: string;
  category: string;
  timestamp: string;
  config: { model: string };
  metrics: EvalMetrics;
  cost: EvalCost;
  details: FileResult[];
}
