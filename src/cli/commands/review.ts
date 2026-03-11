import chalk from 'chalk';
import { runClassicReview } from '../../adapter/classic-review.js';
import { runReview } from '../../adapter/review.js';
import { formatModelForDisplay, loadValidatedConfig } from '../../config/model-config.js';
import type { ReviewEngineOutcome } from '../../core/types.js';
import type { ReviewProgressEvent, ReviewResult, Violation } from '../../types/types.js';
import { SaguaroError } from '../../util/errors.js';
import { logger } from '../../util/logger.js';

const CLI_ACCENT = chalk.hex('#be3c00');

export interface ReviewCommandOptions {
  base?: string;
  head?: string;
  output: 'console' | 'json';
  mode?: 'rules' | 'classic' | 'full';
  rules?: string;
  verbose?: boolean;
  config?: string;
  abortSignal?: AbortSignal;
}

export async function reviewCommand(options: ReviewCommandOptions): Promise<number> {
  const baseRef = options.base ?? 'main';
  const headRef = options.head ?? 'HEAD';
  const mode = options.mode ?? 'rules';

  const config = loadValidatedConfig(options.config);
  const cursorDeeplink = config.output.cursor_deeplink;

  console.log(
    chalk.gray(
      `Starting Saguaro ${mode === 'full' ? 'full' : mode === 'classic' ? 'classic' : 'rules'} review comparing ${CLI_ACCENT(baseRef)} → ${CLI_ACCENT(headRef)}.`
    )
  );

  if (mode === 'classic') {
    return runClassicReviewCli(baseRef, headRef, options);
  }

  if (mode === 'full') {
    const [rulesSettled, classicSettled] = await Promise.allSettled([
      runRulesReviewCli(baseRef, headRef, options, cursorDeeplink),
      runClassicReviewCli(baseRef, headRef, options),
    ]);

    if (rulesSettled.status === 'rejected') {
      console.error(chalk.red(`\nRules review failed: ${rulesSettled.reason}`));
    }
    if (classicSettled.status === 'rejected') {
      console.error(chalk.red(`\nClassic review failed: ${classicSettled.reason}`));
    }

    const rulesExitCode = rulesSettled.status === 'fulfilled' ? rulesSettled.value : 1;
    const classicExitCode = classicSettled.status === 'fulfilled' ? classicSettled.value : 1;
    return Math.max(rulesExitCode, classicExitCode);
  }

  return runRulesReviewCli(baseRef, headRef, options, cursorDeeplink);
}

async function runClassicReviewCli(baseRef: string, headRef: string, options: ReviewCommandOptions): Promise<number> {
  if (options.verbose) {
    logger.verbose('\nRunning classic (staff-engineer) review...');
  }

  const spinner = new CliSpinner('Running classic review...');
  spinner.start();

  let result: Awaited<ReturnType<typeof runClassicReview>>;
  try {
    result = await runClassicReview({ baseRef, headRef, configPath: options.config });
  } catch (error) {
    spinner.stop();
    throw error;
  }
  spinner.stop();

  if (result.findings.length === 0) {
    console.log(chalk.green('\nClassic review: No issues found'));
    console.log(chalk.gray(`  Model: ${formatModelForDisplay(result.model)}`));
    return 0;
  }

  console.log(chalk.red(`\nClassic review: ${result.findings.length} issue(s) found`));
  console.log(chalk.gray(`  Model: ${formatModelForDisplay(result.model)}`));

  if (options.output === 'json') {
    console.log(JSON.stringify({ findings: result.findings, verdict: result.verdict }, null, 2));
    return 1;
  }

  for (const finding of result.findings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    const icon = finding.severity === 'error' ? '✗' : finding.severity === 'warning' ? '⚠' : 'ℹ';
    console.log(`\n  ${icon} ${location} [${finding.severity}]`);
    console.log(`    ${finding.message}`);
  }
  console.log();

  return result.findings.some((f) => f.severity === 'error') ? 1 : 0;
}

async function runRulesReviewCli(
  baseRef: string,
  headRef: string,
  options: ReviewCommandOptions,
  cursorDeeplink: boolean
): Promise<number> {
  if (options.verbose) {
    logger.verbose('\nRunning code review agent...');
  }

  const progressReporter = new ReviewCliProgressReporter();

  let outcome: ReviewEngineOutcome;
  try {
    const reviewResult = await runReview({
      baseRef,
      headRef,
      rulesDir: options.rules,
      verbose: options.verbose,
      configPath: options.config,
      onProgress: progressReporter.onProgress,
      abortSignal: options.abortSignal,
      source: 'cli',
    });
    progressReporter.finish();
    outcome = reviewResult.outcome;
  } catch (error) {
    progressReporter.stop();
    throw error;
  }

  if (outcome.kind === 'no-changed-files') {
    console.log(chalk.gray('No changed files found.'));
    console.log(chalk.gray(`  Comparing ${CLI_ACCENT(baseRef)} → ${CLI_ACCENT(headRef)}. Nothing to review.`));
    console.log(
      chalk.gray(
        `\n  Tips:\n    ${CLI_ACCENT('sag review -b HEAD~1')}  Review the last commit\n    ${CLI_ACCENT('sag review -b main')}   Review changes against main`
      )
    );
    return 0;
  }

  if (options.verbose) {
    logger.verbose(`\nFound ${outcome.changedFiles.length} changed files:`);
    for (const file of outcome.changedFiles) {
      logger.verbose(`  ${file}`);
    }
    logger.verbose('\nRule Selection:');
    logger.verbose(`  ${outcome.rulesLoaded} total rules loaded.`);
    logger.verbose(`  ${outcome.filesWithRules} files have applicable rules.`);
    logger.verbose(`  ${outcome.totalChecks} total checks to perform.`);
  }

  if (outcome.kind === 'no-matching-skills') {
    if (options.rules && outcome.rulesLoaded === 0) {
      throw new SaguaroError(
        'RULES_NOT_LOADED',
        `No rules loaded from ${options.rules}. Expected .md rule files in the directory.`,
        {
          suggestion: 'Run "sag init" to generate starter rules, or check the rules directory.',
        }
      );
    }
    if (outcome.rulesLoaded === 0) {
      console.log('No rules found for this repository hierarchy. Review passed.');
      return 0;
    }
    console.log('No rules matched the changed files. Review passed.');
    return 0;
  }

  printViolations(outcome.result, options.output, cursorDeeplink, !!options.verbose);

  const hasErrors = outcome.result.violations.some((violation: Violation) => violation.severity === 'error');
  return hasErrors ? 1 : 0;
}

interface WorkerParseSummaryDetail {
  matchedLines: number;
  ignoredLines: number;
  violations: number;
  shortCircuitedNoViolations: boolean;
}

class ReviewCliProgressReporter {
  private totalWorkers = 0;
  private completedWorkers = 0;
  private readonly parseSummaryByWorker = new Map<number, WorkerParseSummaryDetail>();
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerFrameIndex = 0;
  private readonly spinnerFrames = ['-', '\\', '|', '/'];
  private spinnerText = '';

  readonly onProgress = (event: ReviewProgressEvent): void => {
    if (event.type === 'run_split') {
      this.totalWorkers = event.totalWorkers;
      this.completedWorkers = 0;
      logger.verbose(`Split ${event.totalFiles} files into ${event.totalWorkers} review batches`);
      this.startSpinner(this.getSpinnerText());
      return;
    }

    if (event.type === 'worker_started') {
      this.totalWorkers = Math.max(this.totalWorkers, event.totalWorkers);
      logger.verbose(`Batch ${event.workerIndex}/${event.totalWorkers} sent (${event.promptChars} chars)`);
      return;
    }

    if (event.type === 'worker_completed') {
      this.totalWorkers = Math.max(this.totalWorkers, event.totalWorkers);
      this.completedWorkers += 1;
      this.updateSpinner(this.getSpinnerText());
      logger.verbose(chalk.green(`✓ Batch ${event.workerIndex}/${event.totalWorkers} complete`));
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
          `Parse batch ${workerIndex}/${this.totalWorkers}: matched=${parseSummary.matchedLines}, ignored=${parseSummary.ignoredLines}, violations=${parseSummary.violations}`
        )
      );

      if (parseSummary.shortCircuitedNoViolations) {
        logger.verbose(chalk.yellow(`  Batch ${workerIndex} short-circuited (no violations)`));
      }
    }
  }

  stop(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[2K');
    }
  }

  private startSpinner(text: string): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
    }
    this.spinnerText = text;
    if (!process.stdout.isTTY) return;
    this.renderSpinner();
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrameIndex = (this.spinnerFrameIndex + 1) % this.spinnerFrames.length;
      this.renderSpinner();
    }, 80);
  }

  private updateSpinner(text: string): void {
    this.spinnerText = text;
    if (process.stdout.isTTY) this.renderSpinner();
  }

  private renderSpinner(): void {
    const frame = this.spinnerFrames[this.spinnerFrameIndex];
    process.stdout.write(`\r\x1b[2K${CLI_ACCENT(frame)} ${this.spinnerText}`);
  }

  private getSpinnerText(): string {
    const workers = Math.max(this.totalWorkers, 0);
    return `Reviewing files... ${this.completedWorkers} of ${workers} batches complete`;
  }
}

class CliSpinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private readonly frames = ['-', '\\', '|', '/'];
  private readonly text: string;

  constructor(text: string) {
    this.text = text;
  }

  start(): void {
    if (!process.stdout.isTTY) return;
    this.render();
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, 80);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (process.stdout.isTTY) {
      process.stdout.write('\r\x1b[2K');
    }
  }

  private render(): void {
    const frame = this.frames[this.frameIndex];
    process.stdout.write(`\r\x1b[2K${CLI_ACCENT(frame)} ${this.text}`);
  }
}

function formatToolCallLogLine(toolName: string, filePath?: string): string {
  if (toolName === 'read_file' && filePath) {
    return `  read_file: ${filePath}`;
  }
  return filePath ? `  ${toolName}: ${filePath}` : `  ${toolName}:`;
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
  const duration = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;
  const formattedCost = cost !== undefined ? `$${cost.toFixed(2)} cost` : null;

  if (result.violations.length === 0) {
    console.log(chalk.green('No rule violations found\n'));
    logger.verbose(chalk.gray(`  Files reviewed: ${filesReviewed}`));
    logger.verbose(chalk.gray(`  Rules checked:  ${rulesChecked}`));
    console.log(chalk.gray(`  Duration:       ${duration}${formattedCost ? `, ${formattedCost}` : ''}`));
    return;
  }

  const groups = groupViolationsByRule(result.violations);

  for (const [ruleId, violations] of groups) {
    const severity = violations[0].severity;
    const icon = severity === 'error' ? '✗' : severity === 'warning' ? '⚠' : 'ℹ';

    if (violations.length === 1) {
      const v = violations[0];
      const lineInfo = v.line ? `:${v.line}` : '';
      console.log(`${icon} ${ruleId} [${severity}]`);
      console.log(`  ${v.file}${lineInfo} — ${v.message}`);
    } else {
      console.log(`${icon} ${ruleId} [${severity}] — ${violations.length} violations`);
      for (const [i, v] of violations.entries()) {
        const lineInfo = v.line ? `:${v.line}` : '';
        console.log(`  ${i + 1}. ${v.file}${lineInfo} — ${v.message}`);
      }
    }
    console.log();
  }

  const { errors, warnings, infos } = result.summary;
  console.log(`${result.violations.length} violation(s): ${errors} errors, ${warnings} warnings, ${infos} infos\n`);
  console.log(chalk.gray(`  Files reviewed: ${filesReviewed}`));
  console.log(chalk.gray(`  Rules checked:  ${rulesChecked}`));
  if (duration) console.log(chalk.gray(`  Duration:       ${duration}${formattedCost ? `, ${formattedCost}` : ''}`));
  console.log();
}

function groupViolationsByRule(violations: Violation[]): Map<string, Violation[]> {
  const groups = new Map<string, Violation[]>();
  for (const v of violations) {
    const existing = groups.get(v.ruleId);
    if (existing) {
      existing.push(v);
    } else {
      groups.set(v.ruleId, [v]);
    }
  }
  return groups;
}
