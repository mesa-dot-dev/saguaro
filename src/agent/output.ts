import chalk from 'chalk';
import type { ReviewResult } from '../types/types.js';

function formatDuration(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

export function printViolations(
  result: ReviewResult,
  format: 'console' | 'json' = 'console',
  showFixPrompt = true
): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { filesReviewed, rulesChecked, durationMs } = result.summary;
  const duration = durationMs ? formatDuration(durationMs) : null;

  if (result.violations.length === 0) {
    console.log(chalk.green('No rule violations found\n'));
    console.log(chalk.gray(`  Files reviewed: ${filesReviewed}`));
    console.log(chalk.gray(`  Rules checked:  ${rulesChecked}`));
    if (duration) console.log(chalk.gray(`  Duration:       ${duration}`));
    console.log();
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
  console.log(`${result.violations.length} violation(s): ${errors} errors, ${warnings} warnings, ${infos} infos\n`);
  console.log(chalk.gray(`  Files reviewed: ${filesReviewed}`));
  console.log(chalk.gray(`  Rules checked:  ${rulesChecked}`));
  if (duration) console.log(chalk.gray(`  Duration:       ${duration}`));
  console.log();

  if (showFixPrompt && result.violations.length > 0) {
    console.log(chalk.bold('Copy/paste fix prompt:\n'));
    console.log(buildFixPrompt(result));
    console.log();
  }
}

function buildFixPrompt(result: ReviewResult): string {
  const lines: string[] = [];
  lines.push('Fix the following code review violations in this repository.');
  lines.push('');
  lines.push('Constraints:');
  lines.push('- Follow existing project patterns.');
  lines.push('- Make minimal changes that resolve violations.');
  lines.push('- Do not suppress lint/type errors.');
  lines.push('- Preserve behavior unless a rule-compliant change requires it.');
  lines.push('- After edits, run typecheck and report results.');
  lines.push('');
  lines.push('Violations:');

  result.violations.forEach((violation, index) => {
    const loc = `${violation.file}${violation.line ? `:${violation.line}` : ''}`;
    lines.push(`${index + 1}) ${loc}`);
    lines.push(`   Rule: ${violation.ruleId}`);
    lines.push(`   Severity: ${violation.severity}`);
    lines.push(`   Message: ${violation.message}`);
    if (violation.suggestion) {
      lines.push(`   Suggestion: ${violation.suggestion}`);
    }
    lines.push('');
  });

  lines.push('Output format:');
  lines.push('- List changed files.');
  lines.push('- Summarize each fix by file.');
  lines.push('- Include typecheck result.');

  return ['```text', ...lines, '```'].join('\n');
}
