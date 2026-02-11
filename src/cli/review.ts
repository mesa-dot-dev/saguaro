import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { runReview } from '../adapter/review.js';
import { getCodebaseContext } from '../indexer/index.js';
import { NoRulesFoundError } from '../lib/errors.js';
import { getDiffs, getRepoRoot, listChangedFilesFromGit } from '../lib/git.js';
import { logger } from '../lib/logger.js';
import { loadValidatedConfig } from '../lib/review-model-config.js';
import type { ReviewProgressEvent, ReviewResult } from '../types/types.js';
import { CliSpinner } from './lib/spinner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = resolvePackageVersion();
const CURSOR_PROMPT_URL_MAX_LENGTH = 8000;
const CLI_ACCENT = chalk.hex('#be3c00');

export interface ReviewOptions {
  base?: string;
  head?: string;
  output: 'console' | 'json';
  rules?: string;
  verbose?: boolean;
  config?: string;
  abortSignal?: AbortSignal;
}

interface WorkerParseSummaryDetail {
  matchedLines: number;
  ignoredLines: number;
  violations: number;
  shortCircuitedNoViolations: boolean;
}

export async function reviewCommand(options: ReviewOptions): Promise<number> {
  const baseRef = options.base ?? 'main';
  const headRef = options.head ?? 'HEAD';

  try {
    const config = loadValidatedConfig(options.config);
    const cursorDeeplink = config.output.cursor_deeplink;
    const indexSettings = {
      enabled: config.index.enabled,
      blastRadiusDepth: config.index.blast_radius_depth,
      contextTokenBudget: config.index.context_token_budget,
    };

    // Pre-compute changed files and diffs
    const changedFiles = listChangedFilesFromGit(baseRef, headRef);
    const diffs = getDiffs(baseRef, headRef);

    if (options.verbose) {
      logger.verbose(`\nPre-computed diffs for ${diffs.size} files.`);
    }

    // Compute codebase context for the indexer (graceful — never blocks review)
    let codebaseContext = '';
    if (indexSettings.enabled && changedFiles.length > 0) {
      // rootDir = repo root (indexing scope), cacheDir = alongside config (cwd/.mesa/cache)
      codebaseContext = await getCodebaseContext({
        rootDir: getRepoRoot(),
        cacheDir: path.join(process.cwd(), '.mesa', 'cache'),
        changedFiles,
        blastRadiusDepth: indexSettings.blastRadiusDepth,
        tokenBudget: indexSettings.contextTokenBudget,
        verbose: options.verbose,
      });
    }

    if (options.verbose) {
      logger.verbose('\nRunning code review agent...');
    }

    const progressReporter = new ReviewCliProgressReporter();

    let outcome: Awaited<ReturnType<typeof runReview>>['outcome'];
    try {
      const reviewResult = await runReview({
        baseRef,
        headRef,
        rulesDir: options.rules,
        verbose: options.verbose,
        configPath: options.config,
        codebaseContext,
        diffs,
        onProgress: progressReporter ? progressReporter.onProgress : undefined,
        abortSignal: options.abortSignal,
      });
      progressReporter?.finish();
      outcome = reviewResult.outcome;
    } catch (error) {
      progressReporter?.stop();
      throw error;
    }

    if (outcome.kind === 'no-changed-files') {
      console.log(chalk.gray('No changed files found.'));
      console.log(chalk.gray(`  Comparing ${CLI_ACCENT(baseRef)} → ${CLI_ACCENT(headRef)}. Nothing to review.`));
      console.log(
        chalk.gray(
          `\n  Tips:\n    ${CLI_ACCENT('mesa review -b HEAD~1')}  Review the last commit\n    ${CLI_ACCENT('mesa review -b main')}   Review changes against main`
        )
      );
      return 0;
    }

    if (options.verbose) {
      logger.verbose(`Mesa v${VERSION}`);
      logger.verbose(`\nFound ${outcome.changedFiles.length} changed files:`);
      outcome.changedFiles.forEach((file) => logger.verbose(`  ${file}`));
      logger.verbose(`\nRule Selection:`);
      logger.verbose(`  ${outcome.rulesLoaded} total rules loaded.`);
      logger.verbose(`  ${outcome.filesWithRules} files have applicable rules.`);
      logger.verbose(`  ${outcome.totalChecks} total checks to perform.`);
    }

    if (outcome.kind === 'no-matching-rules') {
      if (outcome.rulesLoaded === 0) {
        throw new NoRulesFoundError();
      }
      console.log('No rules matched the changed files. Review passed.');
      return 0;
    }

    printViolations(outcome.result, options.output, cursorDeeplink, !!options.verbose);

    const hasErrors = outcome.result.violations.some((violation) => violation.severity === 'error');
    return hasErrors ? 1 : 0;
  } catch (error) {
    // All errors propagate to wrapHandler's printError for tiered display.
    // MesaError subclasses carry their own exitCode (e.g. AgentExecutionError → 3).
    throw error instanceof Error ? error : new Error(`Unexpected error: ${String(error)}`);
  }
}

class ReviewCliProgressReporter {
  private readonly spinner = new CliSpinner();
  private totalWorkers = 0;
  private completedWorkers = 0;
  private readonly parseSummaryByWorker = new Map<number, WorkerParseSummaryDetail>();

  readonly onProgress = (event: ReviewProgressEvent): void => {
    if (event.type === 'run_split') {
      this.totalWorkers = event.totalWorkers;
      this.completedWorkers = 0;
      logger.verbose(`Split ${event.totalFiles} files into ${event.totalWorkers} worker group(s)`);
      this.spinner.start(this.getSpinnerText());
      return;
    }

    if (event.type === 'worker_started') {
      this.totalWorkers = Math.max(this.totalWorkers, event.totalWorkers);
      logger.verbose(`Worker ${event.workerIndex}/${event.totalWorkers} sent (${event.promptChars} chars)`);
      return;
    }

    if (event.type === 'worker_completed') {
      this.totalWorkers = Math.max(this.totalWorkers, event.totalWorkers);
      this.completedWorkers += 1;
      this.spinner.update(this.getSpinnerText());
      logger.verbose(chalk.green(`✓ Worker ${event.workerIndex}/${event.totalWorkers} complete`));
      return;
    }

    if (event.type === 'tool_call') {
      logger.verbose(chalk.gray(formatToolCallLogLine(event.toolName, event.path)));
      return;
    }

    if (event.type === 'parse_summary') {
      this.parseSummaryByWorker.set(event.workerIndex, {
        matchedLines: event.matchedLines,
        ignoredLines: event.ignoredLines,
        violations: event.violations,
        shortCircuitedNoViolations: event.shortCircuitedNoViolations,
      });
      return;
    }

    this.totalWorkers = Math.max(this.totalWorkers, event.totalWorkers);
  };

  finish(): void {
    this.stop();

    for (let workerIndex = 1; workerIndex <= this.totalWorkers; workerIndex += 1) {
      const parseSummary = this.parseSummaryByWorker.get(workerIndex) ?? {
        matchedLines: 0,
        ignoredLines: 0,
        violations: 0,
        shortCircuitedNoViolations: false,
      };

      logger.verbose(
        chalk.gray(
          `Parse worker ${workerIndex}/${this.totalWorkers}: matched=${parseSummary.matchedLines}, ignored=${parseSummary.ignoredLines}, violations=${parseSummary.violations}`
        )
      );

      if (parseSummary.shortCircuitedNoViolations) {
        logger.verbose(chalk.yellow(`  Worker ${workerIndex} parser short-circuited on "no violations found" text`));
      }
    }
  }

  stop(): void {
    this.spinner.stop();
  }

  private getSpinnerText(): string {
    const workers = Math.max(this.totalWorkers, 0);
    return `Processing review... ${this.completedWorkers}/${workers} worker(s) complete`;
  }
}

function formatToolCallLogLine(toolName: string, filePath?: string): string {
  if (toolName === 'read_file' && filePath) {
    return `  read_file: ${filePath}`;
  }

  return filePath ? `  ${toolName}: ${filePath}` : `  ${toolName}:`;
}

export function resolvePackageVersion(): string {
  const candidatePaths = [
    path.resolve(__dirname, '..', '..', 'package.json'),
    path.resolve(__dirname, '..', '..', '..', 'package.json'),
  ];

  for (const candidatePath of candidatePaths) {
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(candidatePath, 'utf8')) as { version?: string };
      if (typeof parsed.version === 'string' && parsed.version.length > 0) {
        return parsed.version;
      }
    } catch (error) {
      void error;
    }
  }

  return 'unknown';
}

function printViolations(
  result: ReviewResult,
  format: 'console' | 'json' = 'console',
  showCursorDeepLink = true,
  verbose = false
): void {
  if (format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const { filesReviewed, rulesChecked, durationMs, cost } = result.summary;
  const duration = durationMs ? formatDuration(durationMs) : null;
  const formattedCost = cost !== undefined ? formatCost(cost) : null;

  if (result.violations.length === 0) {
    console.log(chalk.green('No rule violations found\n'));
    logger.verbose(chalk.gray(`  Files reviewed: ${filesReviewed}`));
    logger.verbose(chalk.gray(`  Rules checked:  ${rulesChecked}`));
    console.log(chalk.gray(`  Duration:       ${duration}${formattedCost ? `, ${formattedCost}` : ''}`));
    return;
  }

  if (!verbose) {
    console.log(`${result.violations.length} violation(s):\n`);
    console.log(chalk.gray(`  Files reviewed: ${filesReviewed}`));
    console.log(chalk.gray(`  Rules checked:  ${rulesChecked}`));
    if (duration) console.log(chalk.gray(`  Duration:       ${duration}${formattedCost ? `, ${formattedCost}` : ''}`));
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
  if (duration) console.log(chalk.gray(`  Duration:       ${duration}${formattedCost ? `, ${formattedCost}` : ''}`));
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

function formatCost(cost: number): string {
  return `$${cost.toFixed(2)} cost`;
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
