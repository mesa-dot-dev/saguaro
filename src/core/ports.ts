import type { ReviewResult, Rule } from '../types/types.js';

export interface ReviewRequest {
  baseRef: string;
  headRef: string;
  verbose?: boolean;
  codebaseContext?: string;
  diffs?: Map<string, string>;
}

export interface ReviewInputChannel {
  listChangedFiles(baseRef: string, headRef: string): Promise<string[]> | string[];
  loadRules(): Promise<Rule[]> | Rule[];
}

export interface ReviewerInput {
  baseRef: string;
  headRef: string;
  filesWithRules: Map<string, Rule[]>;
  verbose?: boolean;
  codebaseContext?: string;
  diffs?: Map<string, string>;
}

export interface Reviewer {
  review(input: ReviewerInput): Promise<ReviewResult>;
}

export interface ClockPort {
  nowMs(): number;
}
