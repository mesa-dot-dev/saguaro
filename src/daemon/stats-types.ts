export type TimeWindow = '1h' | '1d' | '7d' | '30d' | 'all';

export interface AgentUsage {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
}

export interface DaemonStatsAggregation {
  overview: {
    totalReviews: number;
    findings: number;
    hitRate: number;
    errors: number;
    warnings: number;
    failedJobs: number;
    avgDurationSecs: number;
  };
  cost: {
    totalCostUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    avgCostPerReview: number;
    reviewsWithCostData: number;
  } | null;
  byModel: Array<{ model: string; count: number; costUsd: number }>;
  byRepo: Array<{ repo: string; reviews: number; findings: number }>;
  byCategory: Array<{ category: string; count: number }>;
}

export interface DaemonFinding {
  file: string;
  line: number | null;
  message: string;
  severity: 'error' | 'warning';
  categories: string[];
  repoPath: string;
  createdAt: string;
  model: string | null;
  costUsd: number | null;
  completedAt: string | null;
}

export interface DaemonFindingsFilter {
  repo?: string;
  category?: string;
  severity?: 'error' | 'warning';
}
