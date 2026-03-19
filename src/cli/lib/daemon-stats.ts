import path from 'node:path';
import chalk from 'chalk';
import { getDaemonStats } from '../../adapter/daemon-stats.js';
import type { DaemonStatsAggregation, TimeWindow } from '../../daemon/stats-types.js';

const CLI_ACCENT = chalk.hex('#be3c00');

const WINDOW_LABELS: Record<TimeWindow, string> = {
  '1h': 'last 1h',
  '1d': 'last 24h',
  '7d': 'last 7d',
  '30d': 'last 30d',
  all: 'all time',
};

export function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(0)}K`;
  }
  return String(n);
}

function printOverview(stats: DaemonStatsAggregation, label: string): void {
  const { totalReviews, findings, hitRate, errors, warnings, failedJobs, avgDurationSecs } = stats.overview;

  console.log(CLI_ACCENT(`\n  DAEMON REVIEW STATS (${label})`));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  Reviews: ${totalReviews}  |  Findings: ${findings}  |  Hit rate: ${Math.round(hitRate)}%`);
  console.log(`  Errors: ${errors}  |  Warnings: ${warnings}  |  Failed: ${failedJobs}`);
  console.log(`  Avg review: ${Math.round(avgDurationSecs)}s`);
}

function printCost(stats: DaemonStatsAggregation): void {
  if (stats.cost === null) return;

  const { totalCostUsd, avgCostPerReview, totalInputTokens, totalOutputTokens } = stats.cost;

  console.log(CLI_ACCENT('\n  COST & TOKENS'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  Total cost:       $${totalCostUsd.toFixed(2)}`);
  console.log(`  Avg cost/review:  $${avgCostPerReview.toFixed(3)}`);
  console.log(`  Input tokens:     ${formatTokens(totalInputTokens)}`);
  console.log(`  Output tokens:    ${formatTokens(totalOutputTokens)}`);
}

function printModels(stats: DaemonStatsAggregation): void {
  if (stats.byModel.length === 0) return;

  const maxCount = stats.byModel[0].count;

  console.log(CLI_ACCENT('\n  MODELS'));
  console.log(chalk.gray('  ─────────────────────────────'));

  for (const { model, count, costUsd } of stats.byModel) {
    const barLen = Math.max(1, Math.round((count / maxCount) * 20));
    const bar = '\u2588'.repeat(barLen);
    console.log(`  ${model.padEnd(25)} ${bar} ${String(count).padStart(3)}  $${costUsd.toFixed(2)}`);
  }
}

function printRepos(stats: DaemonStatsAggregation): void {
  if (stats.byRepo.length === 0) return;

  const maxReviews = stats.byRepo[0].reviews;

  console.log(CLI_ACCENT('\n  REPOS'));
  console.log(chalk.gray('  ─────────────────────────────'));

  for (const { repo, reviews, findings } of stats.byRepo) {
    const basename = path.basename(repo);
    const barLen = Math.max(1, Math.round((reviews / maxReviews) * 20));
    const bar = '\u2588'.repeat(barLen);
    console.log(
      `  ${basename.padEnd(25)} ${bar} ${String(reviews).padStart(3)} reviews  ${String(findings).padStart(2)} findings`
    );
  }
}

function printCategories(stats: DaemonStatsAggregation): void {
  if (stats.byCategory.length === 0) return;

  const maxCount = stats.byCategory[0].count;

  console.log(CLI_ACCENT('\n  CATEGORIES'));
  console.log(chalk.gray('  ─────────────────────────────'));

  for (const { category, count } of stats.byCategory) {
    const barLen = Math.max(1, Math.round((count / maxCount) * 20));
    const bar = '\u2588'.repeat(barLen);
    console.log(`  ${category.padEnd(25)} ${bar} ${String(count).padStart(3)}`);
  }
}

export function daemonStatsCommand(options: { window: TimeWindow }): number {
  const { stats, empty } = getDaemonStats(options.window);

  if (empty) {
    console.log(chalk.gray('No daemon reviews found. Start the daemon with "sag daemon start".'));
    return 0;
  }

  const label = WINDOW_LABELS[options.window];

  printOverview(stats, label);
  printCost(stats);
  printModels(stats);
  printRepos(stats);
  printCategories(stats);

  console.log();
  return 0;
}
