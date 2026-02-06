import chalk from 'chalk';
import type { ReviewResult } from '../types/types.js';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

export function printViolations(result: ReviewResult, format: 'console' | 'json' = 'console'): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { filesReviewed, rulesChecked, durationMs } = result.summary;
  const duration = durationMs ? formatDuration(durationMs) : null;

  if (result.violations.length === 0) {
    console.log(chalk.green('No rule violations found'));
    const parts = [`${filesReviewed} files reviewed`, `${rulesChecked} rules checked`];
    if (duration) parts.push(duration);
    console.log(chalk.gray(parts.join(' · ')));
    return;
  }

  for (const v of result.violations) {
    const icon = v.severity === 'error' ? '✗' : v.severity === 'warning' ? '⚠' : 'ℹ';
    const lineInfo = v.line ? `:${v.line}` : '';
    console.log(`${icon} ${v.file}${lineInfo} [${v.severity}]`);
    console.log(`  Rule: ${v.ruleId}`);
    console.log(`  ${v.message}`);
    if (v.suggestion) {
      console.log(`  Suggestion: ${v.suggestion}`);
    }
    console.log();
  }

  const { errors, warnings, infos } = result.summary;
  const parts = [
    `${result.violations.length} violation(s) found (${errors} errors, ${warnings} warnings, ${infos} infos)`,
    `${filesReviewed} files · ${rulesChecked} rules`,
  ];
  if (duration) parts.push(duration);
  console.log(parts.join(' · '));
}
