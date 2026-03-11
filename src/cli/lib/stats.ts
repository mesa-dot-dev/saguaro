import chalk from 'chalk';
import type { StatsAggregation } from '../../stats/aggregate.js';
import { aggregateStats, filterByDays } from '../../stats/aggregate.js';
import { readReviewHistory } from '../../stats/history.js';

const CLI_ACCENT = chalk.hex('#be3c00');

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
    console.log(chalk.gray('No review history found. Run "sag review" to start collecting data.'));
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
