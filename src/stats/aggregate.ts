import type { ReviewHistoryEntry } from '../types/types.js';

export interface ModelStats {
  model: string;
  count: number;
  totalCost: number;
}

export interface RuleCount {
  ruleId: string;
  count: number;
}

export interface NeverTriggeredRule {
  ruleId: string;
  evaluatedCount: number;
}

export interface StatsAggregation {
  overview: {
    total: number;
    bySource: { cli: number; hook: number; mcp: number };
    daySpan: number;
  };
  costAndTokens: {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
    totalFilesReviewed: number;
  };
  modelBreakdown: ModelStats[];
  violations: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
    cleanReviews: number;
  };
  topTriggeredRules: RuleCount[];
  neverTriggeredRules: NeverTriggeredRule[];
}

export function filterByDays(entries: ReviewHistoryEntry[], days: number): ReviewHistoryEntry[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
}

// I don't think this scales very well, but it should be fine for local usage.
export function aggregateStats(entries: ReviewHistoryEntry[]): StatsAggregation {
  if (entries.length === 0) {
    return {
      overview: { total: 0, bySource: { cli: 0, hook: 0, mcp: 0 }, daySpan: 0 },
      costAndTokens: {
        totalCost: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalDurationMs: 0,
        totalFilesReviewed: 0,
      },
      modelBreakdown: [],
      violations: { total: 0, errors: 0, warnings: 0, infos: 0, cleanReviews: 0 },
      topTriggeredRules: [],
      neverTriggeredRules: [],
    };
  }

  let cliCount = 0;
  let hookCount = 0;
  let mcpCount = 0;
  for (const e of entries) {
    if (e.source === 'cli') cliCount++;
    else if (e.source === 'hook') hookCount++;
    else if (e.source === 'mcp') mcpCount++;
  }

  const timestamps = entries.map((e) => new Date(e.timestamp).getTime());
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const daySpan = Math.max(1, Math.ceil((latest - earliest) / (24 * 60 * 60 * 1000)));

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalDurationMs = 0;
  let totalFilesReviewed = 0;

  for (const entry of entries) {
    totalCost += entry.result.summary.cost ?? 0;
    totalInputTokens += entry.result.summary.inputTokens ?? 0;
    totalOutputTokens += entry.result.summary.outputTokens ?? 0;
    totalDurationMs += entry.result.summary.durationMs ?? 0;
    totalFilesReviewed += entry.result.summary.filesReviewed;
  }

  const modelMap = new Map<string, { count: number; totalCost: number }>();
  for (const entry of entries) {
    const existing = modelMap.get(entry.model);
    if (existing) {
      existing.count++;
      existing.totalCost += entry.result.summary.cost ?? 0;
    } else {
      modelMap.set(entry.model, { count: 1, totalCost: entry.result.summary.cost ?? 0 });
    }
  }
  const modelBreakdown = [...modelMap.entries()]
    .map(([model, stats]) => ({ model, ...stats }))
    .sort((a, b) => b.count - a.count);

  let totalViolations = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  let totalInfos = 0;
  let cleanReviews = 0;

  for (const entry of entries) {
    const v = entry.result.violations.length;
    totalViolations += v;
    totalErrors += entry.result.summary.errors;
    totalWarnings += entry.result.summary.warnings;
    totalInfos += entry.result.summary.infos;
    if (v === 0) cleanReviews++;
  }

  const ruleCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const v of entry.result.violations) {
      ruleCounts.set(v.ruleId, (ruleCounts.get(v.ruleId) ?? 0) + 1);
    }
  }
  const topTriggeredRules = [...ruleCounts.entries()]
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((a, b) => b.count - a.count);

  const triggeredRuleIds = new Set(ruleCounts.keys());
  const evaluatedCounts = new Map<string, number>();
  for (const entry of entries) {
    const evaluated = entry.rulesEvaluated;
    if (!evaluated || !Array.isArray(evaluated)) continue;
    for (const ruleId of evaluated) {
      evaluatedCounts.set(ruleId, (evaluatedCounts.get(ruleId) ?? 0) + 1);
    }
  }
  const neverTriggeredRules: NeverTriggeredRule[] = [];
  for (const [ruleId, evaluatedCount] of evaluatedCounts) {
    if (!triggeredRuleIds.has(ruleId)) {
      neverTriggeredRules.push({ ruleId, evaluatedCount });
    }
  }
  neverTriggeredRules.sort((a, b) => b.evaluatedCount - a.evaluatedCount);

  return {
    overview: { total: entries.length, bySource: { cli: cliCount, hook: hookCount, mcp: mcpCount }, daySpan },
    costAndTokens: { totalCost, totalInputTokens, totalOutputTokens, totalDurationMs, totalFilesReviewed },
    modelBreakdown,
    violations: {
      total: totalViolations,
      errors: totalErrors,
      warnings: totalWarnings,
      infos: totalInfos,
      cleanReviews,
    },
    topTriggeredRules,
    neverTriggeredRules,
  };
}
