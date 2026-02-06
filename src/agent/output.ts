import chalk from 'chalk';
import type { ReviewResult } from '../types/types.js';

const CURSOR_PROMPT_URL_MAX_LENGTH = 8000;

interface CursorPromptLinks {
  native: string;
  web: string;
}

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
  showFixPrompt = true,
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
      const links = buildCursorPromptLinks(buildCursorPromptText(result));
      if (links) {
        console.log(chalk.bold('Open in Cursor with prefilled prompt:\n'));
        console.log(`  ${terminalLink('Open in Cursor (Web)', links.web)}`);
        console.log(`  ${terminalLink('Open in Cursor (Native)', links.native)}`);
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

  if (showFixPrompt && result.violations.length > 0) {
    console.log(chalk.bold('Copy/paste fix prompt:\n'));
    console.log(buildFixPrompt(result));
    console.log();
  }

  if (showCursorDeepLink && result.violations.length > 0) {
    const links = buildCursorPromptLinks(buildCursorPromptText(result));
    if (links) {
      console.log(chalk.bold('Open in Cursor with prefilled prompt:\n'));
      console.log(`  ${terminalLink('Open in Cursor (Web)', links.web)}`);
      console.log(`  ${terminalLink('Open in Cursor (Native)', links.native)}`);
      console.log();
    } else {
      console.log(chalk.yellow('Cursor deeplink skipped: generated prompt exceeds URL length limit.'));
      console.log();
    }
  }
}

function buildFixPrompt(result: ReviewResult): string {
  return ['```text', buildFixPromptText(result), '```'].join('\n');
}

function buildFixPromptText(result: ReviewResult): string {
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

  return lines.join('\n');
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

function buildCursorPromptLinks(promptText: string): CursorPromptLinks | null {
  const native = new URL('cursor://anysphere.cursor-deeplink/prompt');
  native.searchParams.set('text', promptText);

  const web = new URL('https://cursor.com/link/prompt');
  web.searchParams.set('text', promptText);

  const nativeLink = native.toString();
  const webLink = web.toString();

  if (nativeLink.length > CURSOR_PROMPT_URL_MAX_LENGTH || webLink.length > CURSOR_PROMPT_URL_MAX_LENGTH) {
    return null;
  }

  return { native: nativeLink, web: webLink };
}
