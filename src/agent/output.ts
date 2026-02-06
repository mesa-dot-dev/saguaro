import chalk from 'chalk';
import type { ReviewResult } from '../types/types.js';

const CURSOR_PROMPT_URL_MAX_LENGTH = 8000;

function terminalLink(label: string, url: string): string {
  if (!process.stdout.isTTY) {
    return `${label}: ${url}`;
  }

  const osc = '\u001B]8;;';
  const st = '\u001B\\';
  return `${osc}${url}${st}${label}${osc}${st}`;
}

function formatDuration(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}

export function printViolations(
  result: ReviewResult,
  format: 'console' | 'json' = 'console',
  showCursorDeepLink = true,
  verbose = false
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

  if (!verbose) {
    console.log(`${result.violations.length} violation(s):\n`);
    console.log(chalk.gray(`  Files reviewed: ${filesReviewed}`));
    console.log(chalk.gray(`  Rules checked:  ${rulesChecked}`));
    if (duration) console.log(chalk.gray(`  Duration:       ${duration}`));
    console.log();

    if (showCursorDeepLink) {
      const link = buildCursorPromptLink(buildCursorPromptText(result));
      if (link) {
        console.log(chalk.bold('Open in Cursor with prefilled prompt:\n'));
        console.log(`  ${terminalLink('Open in Cursor', link)}`);
        console.log();
      } else {
        console.log(chalk.yellow('Cursor deeplink skipped: generated prompt exceeds URL length limit.'));
        console.log();
      }
    }

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

  if (showCursorDeepLink && result.violations.length > 0) {
    const link = buildCursorPromptLink(buildCursorPromptText(result));
    if (link) {
      console.log(chalk.bold('Open in Cursor with prefilled prompt:\n'));
      console.log(`  ${terminalLink('Open in Cursor', link)}`);
      console.log();
    } else {
      console.log(chalk.yellow('Cursor deeplink skipped: generated prompt exceeds URL length limit.'));
      console.log();
    }
  }
}

function buildCursorPromptText(result: ReviewResult): string {
  const lines: string[] = [];
  lines.push('Fix these code-review violations in this repository.');
  lines.push('Use minimal changes, keep behavior, do not suppress lint/type errors.');
  lines.push('Run typecheck after edits and summarize changed files.');
  lines.push('');
  lines.push('Violations:');

  result.violations.forEach((violation, index) => {
    const loc = `${violation.file}${violation.line ? `:${violation.line}` : ''}`;
    lines.push(`${index + 1}. ${loc} [${violation.severity}] ${violation.ruleId} - ${violation.message}`);
  });

  return lines.join('\n');
}

function buildCursorPromptLink(promptText: string): string | null {
  const native = new URL('cursor://anysphere.cursor-deeplink/prompt');
  native.searchParams.set('text', promptText);

  const nativeLink = native.toString();

  if (nativeLink.length > CURSOR_PROMPT_URL_MAX_LENGTH) {
    return null;
  }

  return nativeLink;
}
