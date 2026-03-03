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

export interface AgentRunnerResult {
  output: string;
  durationMs: number;
}

export interface AgentRunnerOptions {
  systemPrompt: string;
  prompt: string;
  cwd: string;
  allowedTools?: string[];
  model?: string;
  maxTurns?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
}

export interface AgentRunner {
  execute(options: AgentRunnerOptions): Promise<AgentRunnerResult>;
}

export interface ModelInfo {
  provider: string;
  model: string;
}

export interface ReviewRuntime {
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
  createReviewer(configPath?: string): { reviewer: Reviewer; modelInfo: ModelInfo };
}
