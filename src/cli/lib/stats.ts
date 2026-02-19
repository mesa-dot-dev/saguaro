import chalk from 'chalk';
import { readReviewHistory } from '../../lib/history.js';
import type { ReviewHistoryEntry } from '../../types/types.js';

const CLI_ACCENT = chalk.hex('#be3c00');

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

function printOverview(stats: StatsAggregation): void {
  const { total, bySource, daySpan } = stats.overview;
  const reviewsPerDay = (total / daySpan).toFixed(1);

  console.log(CLI_ACCENT('\n  OVERVIEW'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  Total reviews:    ${total}`);
  console.log(`  Sources:          ${bySource.cli} cli, ${bySource.hook} hook, ${bySource.mcp} mcp`);
  console.log(`  Time span:        ${daySpan} day(s)`);
  console.log(`  Reviews/day:      ${reviewsPerDay}`);
}

function printCostAndTokens(stats: StatsAggregation): void {
  const { totalCost, totalInputTokens, totalOutputTokens, totalDurationMs, totalFilesReviewed } = stats.costAndTokens;
  const avgCost = totalCost / stats.overview.total;

  console.log(CLI_ACCENT('\n  COST & TOKENS'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  Total cost:       $${totalCost.toFixed(2)}`);
  console.log(`  Avg cost/review:  $${avgCost.toFixed(3)}`);
  console.log(`  Input tokens:     ${totalInputTokens.toLocaleString()}`);
  console.log(`  Output tokens:    ${totalOutputTokens.toLocaleString()}`);
  console.log(`  Total duration:   ${(totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`  Files reviewed:   ${totalFilesReviewed}`);
}

function printModelBreakdown(stats: StatsAggregation): void {
  if (stats.modelBreakdown.length === 0) return;

  const maxCount = stats.modelBreakdown[0].count;

  console.log(CLI_ACCENT('\n  MODEL BREAKDOWN'));
  console.log(chalk.gray('  ─────────────────────────────'));

  for (const { model, count, totalCost } of stats.modelBreakdown) {
    const barLen = Math.max(1, Math.round((count / maxCount) * 20));
    const bar = '\u2588'.repeat(barLen);
    const avg = count > 0 ? `avg $${(totalCost / count).toFixed(3)}` : '';
    console.log(`  ${model.padEnd(25)} ${bar} ${count} reviews  $${totalCost.toFixed(2)}  ${avg}`);
  }
}

function printViolationsSummary(stats: StatsAggregation): void {
  const { total, errors, warnings, infos, cleanReviews } = stats.violations;
  const cleanRate = stats.overview.total > 0 ? ((cleanReviews / stats.overview.total) * 100).toFixed(0) : '0';

  console.log(CLI_ACCENT('\n  VIOLATIONS'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  Total:            ${total}`);
  console.log(`  Errors:           ${errors}`);
  console.log(`  Warnings:         ${warnings}`);
  console.log(`  Infos:            ${infos}`);
  console.log(`  Clean reviews:    ${cleanReviews}/${stats.overview.total} (${cleanRate}%)`);
}

function printTopTriggeredRules(stats: StatsAggregation): void {
  if (stats.topTriggeredRules.length === 0) return;

  const maxCount = stats.topTriggeredRules[0].count;

  console.log(CLI_ACCENT('\n  TOP TRIGGERED RULES'));
  console.log(chalk.gray('  ─────────────────────────────'));

  for (const { ruleId, count } of stats.topTriggeredRules) {
    const barLen = Math.max(1, Math.round((count / maxCount) * 20));
    const bar = '\u2588'.repeat(barLen);
    console.log(`  ${ruleId.padEnd(30)} ${bar} ${count}`);
  }
}

function printNeverTriggeredRules(stats: StatsAggregation): void {
  if (stats.neverTriggeredRules.length === 0) return;

  console.log(CLI_ACCENT('\n  NEVER TRIGGERED RULES'));
  console.log(chalk.gray('  ─────────────────────────────'));

  for (const { ruleId, evaluatedCount } of stats.neverTriggeredRules) {
    console.log(`  ${ruleId.padEnd(30)} checked ${evaluatedCount} time(s), 0 violations`);
  }
}

export interface StatsOptions {
  days?: number;
}

export function statsCommand(options: StatsOptions): number {
  const entries = readReviewHistory();

  if (entries.length === 0) {
    console.log(chalk.gray('No review history found. Run "mesa review" to start collecting data.'));
    return 0;
  }

  const filtered = options.days ? filterByDays(entries, options.days) : entries;

  if (filtered.length === 0) {
    console.log(chalk.gray(`No reviews in the last ${options.days} day(s).`));
    return 0;
  }

  const stats = aggregateStats(filtered);

  printOverview(stats);
  printCostAndTokens(stats);
  printModelBreakdown(stats);
  printViolationsSummary(stats);
  printTopTriggeredRules(stats);
  printNeverTriggeredRules(stats);

  console.log();
  return 0;
}
