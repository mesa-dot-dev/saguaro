import { execFileSync } from 'node:child_process';
import type { LanguageModel } from 'ai';
import { generateText, stepCountIs, tool } from 'ai';
import chalk from 'chalk';
import { z } from 'zod';
import type { ReviewResult, Rule } from '../types/types.js';
import { parseViolationsDetailed } from './review-parse.js';
import { buildPrompt } from './review-prompt.js';
import { createProcessingSpinner } from './review-spinner.js';

export interface RunReviewOptions {
  baseBranch: string;
  headRef: string;
  filesWithRules: Map<string, Rule[]>;
  model: LanguageModel;
  maxSteps?: number;
  filesPerWorker?: number;
  verbose?: boolean;
}

const DEFAULT_FILES_PER_WORKER = 3;
const DEFAULT_MAX_STEPS = 10;

const SYSTEM_PROMPT = `You are a code reviewer. You review ONLY the new/changed lines in a git diff.

Workflow:
1. For each file in the review scope, call the view_diff tool with the filepath and base branch
2. If view_diff returns 'No changes.', skip the file
3. Read ONLY the lines prefixed with '+' (added lines) in the diff
4. Check those added lines against the applicable rules
5. After checking ALL files, output violations in this exact format, one per line:
   [rule-id] file:line - description
6. If no violations found across all files, respond with exactly: No violations found.

Rules:
- ONLY flag code on '+' lines. NEVER flag '-' lines or unchanged context.
- Do NOT use bash, grep, or glob. Use ONLY the view_diff tool to get diffs.
- Be concise. No preamble, no summary, no explanation beyond the violation format.
- If a rule does not apply to any added lines in a file, skip it silently.
- When all files have been checked, output results immediately and stop.`;

function createViewDiffTool(headRef: string, gitRoot: string) {
  return tool({
    description:
      'View the git diff for a specific file between a base branch and configured head ref. Returns only the diff output. If the file has no changes, returns "No changes."',
    inputSchema: z.object({
      filepath: z.string().describe('The file path to diff'),
      base: z.string().describe('The base branch to diff against'),
    }),
    execute: async ({ filepath, base }) => {
      try {
        const output = execFileSync('git', ['diff', `${base}...${headRef}`, '--', filepath], {
          encoding: 'utf8',
          cwd: gitRoot,
          maxBuffer: 1024 * 1024,
        });
        return output.trim() || 'No changes.';
      } catch (e) {
        return `[VIEW_DIFF_ERROR] ${e instanceof Error ? e.message : String(e)}`;
      }
    },
  });
}

export async function runReviewAgent(options: RunReviewOptions): Promise<ReviewResult> {
  const gitRoot = resolveGitRoot();
  const viewDiffTool = createViewDiffTool(options.headRef, gitRoot);

  const filesPerWorker = ensurePositiveInteger(options.filesPerWorker, DEFAULT_FILES_PER_WORKER, 'files_per_worker');
  const maxSteps = ensurePositiveInteger(options.maxSteps, DEFAULT_MAX_STEPS, 'max_steps_size');
  const fileGroups = splitFilesForWorkers(options.filesWithRules, filesPerWorker);

  if (options.verbose) {
    console.log(chalk.gray(`Split ${options.filesWithRules.size} files into ${fileGroups.length} worker group(s)`));
  }

  const spinner = createProcessingSpinner(
    process.stdout.isTTY,
    `Processing review... 0/${fileGroups.length} worker(s) complete`
  );

  let completedCount = 0;
  spinner.start();

  try {
    const results = await Promise.all(
      fileGroups.map((group, i) => {
        const workerIndex = i + 1;
        const workerLabel = `${workerIndex}/${fileGroups.length}`;
        const prompt = buildPrompt({
          baseBranch: options.baseBranch,
          headRef: options.headRef,
          filesWithRules: group,
        });

        if (options.verbose) {
          console.log(chalk.gray(`Worker ${workerLabel} sent (${prompt.length} chars)`));
        }

        return generateText({
          model: options.model,
          system: SYSTEM_PROMPT,
          tools: { view_diff: viewDiffTool },
          stopWhen: stepCountIs(maxSteps),
          prompt,
          onStepFinish({ toolCalls }) {
            if (options.verbose) {
              for (const call of toolCalls) {
                if (!call.dynamic && call.toolName === 'view_diff') {
                  spinner.log(chalk.cyan(`  [${workerIndex}] ↳ ${call.toolName}: ${call.input.filepath}`));
                }
              }
            }
          },
        }).then((result) => {
          completedCount++;
          spinner.setMessage(`Processing review... ${completedCount}/${fileGroups.length} worker(s) complete`);
          spinner.log(chalk.green(`✓ Worker ${workerLabel} complete`));
          return result;
        });
      })
    );

    spinner.stop();

    const texts = results.map((r) =>
      r.steps
        .map((s) => s.text)
        .filter(Boolean)
        .join('\n')
    );
    const parseResults = texts.map((text) => parseViolationsDetailed(text, options.filesWithRules));
    const allViolations = parseResults.flatMap((result) => result.violations);

    if (options.verbose) {
      for (let i = 0; i < parseResults.length; i++) {
        const result = parseResults[i];
        const workerIndex = i + 1;
        console.log(
          chalk.gray(
            `Parse worker ${workerIndex}/${parseResults.length}: matched=${result.matchedLines}, ignored=${result.ignoredLines}, violations=${result.violations.length}`
          )
        );
        if (result.shortCircuitedNoViolations) {
          console.log(chalk.yellow(`  Worker ${workerIndex} parser short-circuited on "no violations found" text`));
        }
      }
    }

    return {
      violations: allViolations,
      summary: {
        filesReviewed: options.filesWithRules.size,
        rulesChecked: countRules(options.filesWithRules),
        errors: allViolations.filter((v) => v.severity === 'error').length,
        warnings: allViolations.filter((v) => v.severity === 'warning').length,
        infos: allViolations.filter((v) => v.severity === 'info').length,
      },
    };
  } catch (error) {
    spinner.stop();
    throw error;
  }
}

function splitFilesForWorkers(filesWithRules: Map<string, Rule[]>, filesPerWorker: number): Map<string, Rule[]>[] {
  const entries = Array.from(filesWithRules.entries());
  const groups: Map<string, Rule[]>[] = [];
  for (let i = 0; i < entries.length; i += filesPerWorker) {
    groups.push(new Map(entries.slice(i, i + filesPerWorker)));
  }
  return groups;
}

function countRules(filesWithRules: Map<string, Rule[]>): number {
  const uniqueRules = new Set<string>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      uniqueRules.add(rule.id);
    }
  }
  return uniqueRules.size;
}

function ensurePositiveInteger(value: number | undefined, fallback: number, field: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${field}: expected a positive integer`);
  }

  return value;
}

function resolveGitRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Not a git repository');
  }
}
