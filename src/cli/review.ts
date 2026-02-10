import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { isReviewAdapterExecutionError, runReview } from '../adapter/review.js';
import { getCodebaseContext } from '../indexer/index.js';
import { getDiffs, getRepoRoot, listChangedFilesFromGit } from '../lib/git.js';
import type { ReviewProgressEvent, ReviewResult } from '../types/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VERSION = resolvePackageVersion();
const CURSOR_PROMPT_URL_MAX_LENGTH = 8000;
const CLI_ACCENT = chalk.hex('#be3c00');

interface ReviewOptions {
  base?: string;
  head?: string;
  output: 'console' | 'json';
  rules?: string;
  verbose?: boolean;
  config?: string;
}

interface CliOutputConfig {
  output?: {
    cursor_deeplink?: boolean;
  };
  index?: {
    enabled?: boolean;
    blast_radius_depth?: number;
    context_token_budget?: number;
  };
}

interface IndexSettings {
  enabled: boolean;
  blastRadiusDepth: number;
  contextTokenBudget: number;
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
    const cursorDeeplink = loadCliCursorDeeplinkConfig(options.config);
    const indexSettings = loadIndexSettings(options.config);

    // Pre-compute changed files and diffs
    const changedFiles = listChangedFilesFromGit(baseRef, headRef);
    const diffs = getDiffs(baseRef, headRef);

    if (options.verbose) {
      console.log(`\nPre-computed diffs for ${diffs.size} files.`);
    }

    // Compute codebase context for the indexer (graceful — never blocks review)
    let codebaseContext = '';
    if (indexSettings.enabled && changedFiles.length > 0) {
      // rootDir = repo root (indexing scope), cacheDir = alongside config (cwd/.mesa/cache)
      codebaseContext = getCodebaseContext({
        rootDir: getRepoRoot(),
        cacheDir: path.join(process.cwd(), '.mesa', 'cache'),
        changedFiles,
        blastRadiusDepth: indexSettings.blastRadiusDepth,
        tokenBudget: indexSettings.contextTokenBudget,
        verbose: options.verbose,
      });
    }

    if (options.verbose) {
      console.log('\nRunning code review agent...');
    }

    const progressReporter = options.verbose ? new ReviewCliProgressReporter() : null;

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
      });
      progressReporter?.finish();
      outcome = reviewResult.outcome;
    } catch (error) {
      progressReporter?.stop();
      throw error;
    }

    if (outcome.kind === 'no-changed-files') {
      if (options.verbose) {
        console.log('No changed files found.');
      }
      return 0;
    }

    if (options.verbose) {
      console.log(`Mesa v${VERSION}`);
      console.log(`\nFound ${outcome.changedFiles.length} changed files:`);
      outcome.changedFiles.forEach((file) => console.log(`  ${file}`));
      console.log(`\nRule Selection:`);
      console.log(`  ${outcome.rulesLoaded} total rules loaded.`);
      console.log(`  ${outcome.filesWithRules} files have applicable rules.`);
      console.log(`  ${outcome.totalChecks} total checks to perform.`);
    }

    if (outcome.kind === 'no-matching-rules') {
      console.log('No rules matched the changed files. Review passed.');
      return 0;
    }

    printViolations(outcome.result, options.output, cursorDeeplink, !!options.verbose);

    const hasErrors = outcome.result.violations.some((violation) => violation.severity === 'error');
    return hasErrors ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isReviewAdapterExecutionError(error)) {
      console.error(message);
      return 3;
    }
    console.error(`Error: ${message}`);
    return 1;
  }
}

class CliSpinner {
  private readonly frames = ['-', '\\', '|', '/'];
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private isRunning = false;
  private text = '';

  start(text: string): void {
    this.text = text;
    this.isRunning = true;

    if (!process.stdout.isTTY) {
      return;
    }

    this.render();
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, 80);
  }

  update(text: string): void {
    this.text = text;
    if (this.isRunning && process.stdout.isTTY) {
      this.render();
    }
  }

  log(message: string): void {
    if (this.isRunning && process.stdout.isTTY) {
      this.clearLine();
      console.log(message);
      this.render();
      return;
    }

    console.log(message);
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (process.stdout.isTTY) {
      this.clearLine();
    }
  }

  private render(): void {
    const frame = this.frames[this.frameIndex];
    process.stdout.write(`\r${CLI_ACCENT(frame)} ${this.text}`);
  }

  private clearLine(): void {
    process.stdout.write('\r\x1b[2K');
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
      this.spinner.log(chalk.gray(`Split ${event.totalFiles} files into ${event.totalWorkers} worker group(s)`));
      this.spinner.start(this.getSpinnerText());
      return;
    }

    if (event.type === 'worker_started') {
      this.totalWorkers = Math.max(this.totalWorkers, event.totalWorkers);
      this.spinner.log(
        chalk.gray(`Worker ${event.workerIndex}/${event.totalWorkers} sent (${event.promptChars} chars)`)
      );
      return;
    }

    if (event.type === 'worker_completed') {
      this.totalWorkers = Math.max(this.totalWorkers, event.totalWorkers);
      this.completedWorkers += 1;
      this.spinner.update(this.getSpinnerText());
      this.spinner.log(chalk.green(`✓ Worker ${event.workerIndex}/${event.totalWorkers} complete`));
      return;
    }

    if (event.type === 'tool_call') {
      this.spinner.log(chalk.gray(formatToolCallLogLine(event.toolName, event.path)));
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

      console.log(
        chalk.gray(
          `Parse worker ${workerIndex}/${this.totalWorkers}: matched=${parseSummary.matchedLines}, ignored=${parseSummary.ignoredLines}, violations=${parseSummary.violations}`
        )
      );

      if (parseSummary.shortCircuitedNoViolations) {
        console.log(chalk.yellow(`  Worker ${workerIndex} parser short-circuited on "no violations found" text`));
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

function resolvePackageVersion(): string {
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

function loadCliCursorDeeplinkConfig(configPath?: string): boolean {
  const resolvedPath = resolveCliConfigPath(configPath);
  if (!resolvedPath) {
    throw new Error('Mesa config not found. Run "mesa init" or pass --config.');
  }

  const contents = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = yaml.load(contents);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid Mesa config at ${resolvedPath}`);
  }

  const output = (parsed as CliOutputConfig).output;
  if (typeof output?.cursor_deeplink !== 'boolean') {
    throw new Error('Invalid config: output.cursor_deeplink is required and must be true or false.');
  }

  return output.cursor_deeplink;
}

function loadIndexSettings(configPath?: string): IndexSettings {
  const resolvedPath = resolveCliConfigPath(configPath);
  if (!resolvedPath) {
    return { enabled: false, blastRadiusDepth: 2, contextTokenBudget: 4000 };
  }

  try {
    const contents = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = yaml.load(contents) as CliOutputConfig | null;
    if (!parsed || typeof parsed !== 'object') {
      return { enabled: false, blastRadiusDepth: 2, contextTokenBudget: 4000 };
    }

    return {
      enabled: parsed.index?.enabled !== false,
      blastRadiusDepth: parsed.index?.blast_radius_depth ?? 2,
      contextTokenBudget: parsed.index?.context_token_budget ?? 4000,
    };
  } catch {
    return { enabled: false, blastRadiusDepth: 2, contextTokenBudget: 4000 };
  }
}

function resolveCliConfigPath(configPath?: string): string | null {
  if (configPath) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    throw new Error(`Config file not found: ${configPath}`);
  }

  const envPath = process.env.MESA_CONFIG;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const defaultPath = path.resolve(process.cwd(), '.mesa', 'config.yaml');
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
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
