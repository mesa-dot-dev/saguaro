import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import yargs from 'yargs';
import type { ReviewResult } from '../src/types/types.js';
import { scoreEval } from './scorer.js';
import { type EvalMetrics, type EvalResult, type EvalRubric, EvalRubricSchema } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const evalsDir = path.dirname(new URL(import.meta.url).pathname);
const rubricsDir = path.resolve(evalsDir, 'rubrics');
const resultsDir = path.resolve(evalsDir, 'results');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface RunArgs {
  rubric?: string;
  category?: string;
  verbose: boolean;
  lineTolerance: number;
}

const argv = yargs(process.argv.slice(2))
  .scriptName('evals/run')
  .usage('Usage: bun run evals/run.ts [options]')
  .option('rubric', {
    type: 'string',
    describe: 'Run a single rubric by ID',
  })
  .option('category', {
    type: 'string',
    describe: 'Run all rubrics in a category',
  })
  .option('verbose', {
    type: 'boolean',
    describe: 'Pass verbose flag to the review CLI',
    default: false,
  })
  .option('line-tolerance', {
    type: 'number',
    describe: 'Override default line tolerance for location matching',
    default: 5,
  })
  .help()
  .strict()
  .parseSync() as unknown as RunArgs;

// ---------------------------------------------------------------------------
// Rubric discovery & validation
// ---------------------------------------------------------------------------

function discoverRubrics(): EvalRubric[] {
  if (!fs.existsSync(rubricsDir)) {
    console.error(chalk.red(`Rubrics directory not found: ${rubricsDir}`));
    process.exit(1);
  }

  const files = fs.readdirSync(rubricsDir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.error(chalk.red('No rubric JSON files found in rubrics/'));
    process.exit(1);
  }

  const rubrics: EvalRubric[] = [];

  for (const file of files) {
    const filePath = path.join(rubricsDir, file);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const parsed = EvalRubricSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(chalk.red(`Invalid rubric ${file}:`));
      console.error(chalk.gray(JSON.stringify(parsed.error.issues, null, 2)));
      process.exit(1);
    }

    rubrics.push(parsed.data);
  }

  return rubrics;
}

function filterRubrics(rubrics: EvalRubric[]): EvalRubric[] {
  if (argv.rubric) {
    const filtered = rubrics.filter((r) => r.id === argv.rubric);
    if (filtered.length === 0) {
      console.error(chalk.red(`No rubric found with id "${argv.rubric}"`));
      console.error(chalk.gray(`Available: ${rubrics.map((r) => r.id).join(', ')}`));
      process.exit(1);
    }
    return filtered;
  }

  if (argv.category) {
    const filtered = rubrics.filter((r) => r.category === argv.category);
    if (filtered.length === 0) {
      console.error(chalk.red(`No rubrics found in category "${argv.category}"`));
      console.error(chalk.gray(`Available categories: ${[...new Set(rubrics.map((r) => r.category))].join(', ')}`));
      process.exit(1);
    }
    return filtered;
  }

  return rubrics;
}

// ---------------------------------------------------------------------------
// Zero metrics (for skipped/failed rubrics)
// ---------------------------------------------------------------------------

const ZERO_METRICS: EvalMetrics = {
  precision: 0,
  recall: 0,
  f1: 0,
  locationAccuracy: 0,
  fpRate: 0,
};

// ---------------------------------------------------------------------------
// Run a single rubric via the actual CLI
// ---------------------------------------------------------------------------

function runRubric(rubric: EvalRubric): EvalResult {
  const rulesPath = path.resolve(evalsDir, 'rules', rubric.id);
  const timestamp = new Date().toISOString();

  if (!fs.existsSync(rulesPath)) {
    console.warn(chalk.yellow(`  Rules directory not found: ${rulesPath} — skipping`));
    return {
      rubricId: rubric.id,
      category: rubric.category,
      timestamp,
      config: { model: 'unknown' },
      metrics: ZERO_METRICS,
      cost: { durationMs: 0, inputTokens: 0, outputTokens: 0, cost: 0 },
      details: [],
    };
  }

  // Shell out to the actual CLI: `bun run review -- --base <base> --head <head> ...`
  const args = [
    'run',
    'review',
    '--',
    '--base',
    rubric.compare.base,
    '--head',
    rubric.compare.head,
    '--rules',
    rulesPath,
    '--output',
    'json',
  ];
  if (argv.verbose) args.push('--verbose');

  const startMs = Date.now();
  let stdout: string;

  try {
    stdout = execFileSync('bun', args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      cwd: path.resolve(evalsDir, '..'),
      // CLI exits 1 when violations found — that's expected, not an error
      stdio: ['pipe', 'pipe', argv.verbose ? 'inherit' : 'pipe'],
    });
  } catch (err: unknown) {
    // execFileSync throws on non-zero exit. Exit code 1 = violations found (good).
    // The JSON output is on stdout regardless.
    const execErr = err as { stdout?: string; stderr?: string; status?: number };
    if (execErr.status === 1 && execErr.stdout) {
      stdout = execErr.stdout;
    } else {
      console.error(chalk.red(`  CLI failed (exit ${execErr.status}):`));
      if (execErr.stderr) console.error(chalk.gray(execErr.stderr));
      return {
        rubricId: rubric.id,
        category: rubric.category,
        timestamp,
        config: { model: 'unknown' },
        metrics: ZERO_METRICS,
        cost: { durationMs: Date.now() - startMs, inputTokens: 0, outputTokens: 0, cost: 0 },
        details: [],
      };
    }
  }

  const durationMs = Date.now() - startMs;

  // Parse the JSON ReviewResult from stdout.
  // The CLI may print non-JSON lines (build output, status messages) before the JSON.
  // Extract the JSON object by finding the first '{' and last '}'.
  const jsonStart = stdout.indexOf('{');
  const jsonEnd = stdout.lastIndexOf('}');

  let reviewResult: ReviewResult;
  try {
    if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON found');
    reviewResult = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
  } catch {
    console.error(chalk.red('  Failed to parse CLI JSON output'));
    if (argv.verbose) console.error(chalk.gray(stdout.slice(0, 500)));
    return {
      rubricId: rubric.id,
      category: rubric.category,
      timestamp,
      config: { model: 'unknown' },
      metrics: ZERO_METRICS,
      cost: { durationMs, inputTokens: 0, outputTokens: 0, cost: 0 },
      details: [],
    };
  }

  // Score against rubric
  const scored = scoreEval(rubric, reviewResult, argv.lineTolerance);
  const modelLabel = [reviewResult.summary.provider, reviewResult.summary.model].filter(Boolean).join('/') || 'unknown';

  return {
    rubricId: rubric.id,
    category: rubric.category,
    timestamp,
    config: { model: modelLabel },
    metrics: scored.metrics,
    cost: {
      durationMs,
      inputTokens: reviewResult.summary.inputTokens ?? 0,
      outputTokens: reviewResult.summary.outputTokens ?? 0,
      cost: reviewResult.summary.cost ?? 0,
    },
    details: scored.details,
  };
}

// ---------------------------------------------------------------------------
// Result persistence
// ---------------------------------------------------------------------------

function writeResult(result: EvalResult): string {
  fs.mkdirSync(resultsDir, { recursive: true });
  const safeTimestamp = result.timestamp.replace(/:/g, '-');
  const filename = `${result.rubricId}-${safeTimestamp}.json`;
  const filePath = path.join(resultsDir, filename);
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  return filePath;
}

// ---------------------------------------------------------------------------
// Summary table
// ---------------------------------------------------------------------------

function pad(str: string, width: number): string {
  return str.length >= width ? str.slice(0, width) : str + ' '.repeat(width - str.length);
}

function fmtNum(n: number): string {
  return n.toFixed(2);
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function printSummaryTable(results: EvalResult[]): void {
  const cols = {
    scenario: 18,
    category: 10,
    prec: 7,
    recall: 7,
    f1: 7,
    locAcc: 9,
    time: 8,
    cost: 9,
  };

  const sep = (char: string, left: string, mid: string, right: string) => {
    return (
      left +
      char.repeat(cols.scenario) +
      mid +
      char.repeat(cols.category) +
      mid +
      char.repeat(cols.prec) +
      mid +
      char.repeat(cols.recall) +
      mid +
      char.repeat(cols.f1) +
      mid +
      char.repeat(cols.locAcc) +
      mid +
      char.repeat(cols.time) +
      mid +
      char.repeat(cols.cost) +
      right
    );
  };

  const row = (vals: string[]) => {
    const widths = [cols.scenario, cols.category, cols.prec, cols.recall, cols.f1, cols.locAcc, cols.time, cols.cost];
    return `\u2502${vals.map((v, i) => ` ${pad(v, widths[i] - 2)} `).join('\u2502')}\u2502`;
  };

  const top = sep('\u2500', '\u250c', '\u252c', '\u2510');
  const mid = sep('\u2500', '\u251c', '\u253c', '\u2524');
  const bot = sep('\u2500', '\u2514', '\u2534', '\u2518');

  console.log();
  console.log(top);
  console.log(chalk.bold(row(['Scenario', 'Category', 'Prec', 'Recall', 'F1', 'Loc Acc', 'Time', 'Cost'])));
  console.log(mid);

  for (const r of results) {
    console.log(
      row([
        r.rubricId,
        r.category,
        fmtNum(r.metrics.precision),
        fmtNum(r.metrics.recall),
        fmtNum(r.metrics.f1),
        fmtNum(r.metrics.locationAccuracy),
        fmtDuration(r.cost.durationMs),
        fmtCost(r.cost.cost),
      ])
    );
    console.log(mid);
  }

  // Aggregate row
  if (results.length > 0) {
    const n = results.length;
    const agg: EvalMetrics = {
      precision: results.reduce((s, r) => s + r.metrics.precision, 0) / n,
      recall: results.reduce((s, r) => s + r.metrics.recall, 0) / n,
      f1: results.reduce((s, r) => s + r.metrics.f1, 0) / n,
      locationAccuracy: results.reduce((s, r) => s + r.metrics.locationAccuracy, 0) / n,
      fpRate: results.reduce((s, r) => s + r.metrics.fpRate, 0) / n,
    };
    const totalCost = results.reduce((s, r) => s + r.cost.cost, 0);
    const totalTime = results.reduce((s, r) => s + r.cost.durationMs, 0);

    console.log(
      chalk.bold(
        row([
          'AGGREGATE',
          '',
          fmtNum(agg.precision),
          fmtNum(agg.recall),
          fmtNum(agg.f1),
          fmtNum(agg.locationAccuracy),
          fmtDuration(totalTime),
          fmtCost(totalCost),
        ])
      )
    );
  }

  console.log(bot);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log(chalk.bold('\nMesa Eval Runner\n'));

  const allRubrics = discoverRubrics();
  const rubrics = filterRubrics(allRubrics);

  console.log(chalk.gray(`Found ${rubrics.length} rubric(s) to run\n`));

  const results: EvalResult[] = [];

  for (const rubric of rubrics) {
    console.log(chalk.cyan(`Running: ${rubric.id} (${rubric.category})`));

    const result = runRubric(rubric);
    results.push(result);

    const resultPath = writeResult(result);
    console.log(chalk.gray(`  Model: ${result.config.model}`));
    console.log(chalk.gray(`  Result written to ${resultPath}`));
    console.log(
      chalk.gray(
        `  F1=${fmtNum(result.metrics.f1)} Precision=${fmtNum(result.metrics.precision)} Recall=${fmtNum(result.metrics.recall)}`
      )
    );
    console.log();
  }

  printSummaryTable(results);
}

main();
