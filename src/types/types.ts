export type Severity = 'error' | 'warning' | 'info';

export interface Violation {
  ruleId: string;
  ruleTitle: string;
  severity: Severity;
  file: string;
  line?: number;
  column?: number;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  violations: Violation[];
  summary: {
    filesReviewed: number;
    rulesChecked: number;
    errors: number;
    warnings: number;
    infos: number;
    failedFiles?: number;
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    provider?: string;
    model?: string;
  };
}

export interface RulePolicy {
  id: string;
  title: string;
  severity: Severity;
  globs: string[];
  instructions: string;
  examples?: {
    violations?: string[];
    compliant?: string[];
  };
  tags?: string[];
  priority?: number;
}

export interface ReviewRunSplitProgressEvent {
  type: 'run_split';
  totalFiles: number;
  totalWorkers: number;
}

export interface ReviewWorkerStartedProgressEvent {
  type: 'worker_started';
  workerIndex: number;
  totalWorkers: number;
  promptChars: number;
}

export interface ReviewWorkerCompletedProgressEvent {
  type: 'worker_completed';
  workerIndex: number;
  totalWorkers: number;
  toolCalls?: number;
  durationMs: number;
}

export interface ReviewToolCallProgressEvent {
  type: 'tool_call';
  workerIndex: number;
  totalWorkers: number;
  toolName: string;
  path?: string;
}

export interface ReviewParseSummaryProgressEvent {
  type: 'parse_summary';
  workerIndex: number;
  totalWorkers: number;
  matchedLines: number;
  ignoredLines: number;
  violations: number;
  shortCircuitedNoViolations: boolean;
}

export interface ReviewRunSummaryProgressEvent {
  type: 'run_summary';
  totalWorkers: number;
  totalToolCalls: number;
  totalMatched: number;
  totalIgnored: number;
  totalViolations: number;
  durationMs: number;
}

export type ReviewProgressEvent =
  | ReviewRunSplitProgressEvent
  | ReviewWorkerStartedProgressEvent
  | ReviewWorkerCompletedProgressEvent
  | ReviewToolCallProgressEvent
  | ReviewParseSummaryProgressEvent
  | ReviewRunSummaryProgressEvent;

export type ReviewProgressCallback = (event: ReviewProgressEvent) => void;

export interface ReviewHistoryEntry {
  timestamp: string;
  source: 'cli' | 'hook' | 'mcp';
  baseRef: string;
  headRef: string;
  provider: string;
  model: string;
  rulesEvaluated: string[];
  result: ReviewResult;
}
