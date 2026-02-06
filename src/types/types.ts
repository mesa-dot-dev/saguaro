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
    durationMs?: number;
  };
}

export interface Rule {
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
}
