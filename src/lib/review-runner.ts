import fs from 'node:fs';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import { generateText, stepCountIs, tool } from 'ai';
import chalk from 'chalk';
import { z } from 'zod';
import type { ReviewResult, Rule } from '../types/types.js';
import { parseViolationsDetailed } from './review-parse.js';
import { buildPrompt } from './review-prompt.js';
import { createProcessingSpinner } from './review-spinner.js';

export interface RunReviewOptions {
  filesWithRules: Map<string, Rule[]>;
  diffs: Map<string, string>;
  model: LanguageModel;
  filesPerWorker?: number;
  verbose?: boolean;
  /** Markdown section with import graph + blast radius context from the codebase indexer */
  codebaseContext?: string;
}

const DEFAULT_FILES_PER_WORKER = 3;

const SYSTEM_PROMPT = `You are a code review enforcement agent. Your ONLY job is to check whether new code changes violate the defined rules. You do not make suggestions, observations, or compliments. Silence means approval.

## Workflow

You will receive three sections of context in order:

1. **Codebase Map** — A dependency graph showing exports, imports, and relationships between files in the blast radius of this change. This is your navigation guide. Study it before reading any diffs.
2. **Files to Review** — Git diffs for each changed file with their applicable rules listed.
3. **Rules** — Full definitions of each rule including instructions and examples.

Follow this process:

### Phase 1: Orient
Read the Codebase Map. Understand which files are changed, which files import from them, and which files they depend on. Build a mental model of how the changed code connects to the rest of the codebase.

### Phase 2: Review
For each file, read its diff. Check ONLY the added lines (lines prefixed with "+") against the applicable rules. Most violations can be identified from the diff alone.

### Phase 3: Investigate (only when needed)
Some rules require understanding cross-file behavior (e.g., "validate inputs before passing to external functions"). When a rule requires this AND the Codebase Map shows a relevant connection, use the read_file tool to inspect that specific file.

**When to use read_file:**
- The rule's instructions explicitly or implicitly require understanding code in another file
- The Codebase Map shows a concrete import/dependency relationship to follow
- You need to see the implementation of an imported function to determine if a rule is violated

**When NOT to use read_file:**
- The diff alone is sufficient to check the rule
- The Codebase Map shows no relevant connections for the rule being checked
- You are curious but the rule doesn't require cross-file context

If no Codebase Map is provided, review using only the diffs. Do not speculatively search the codebase.

## Output

After reviewing ALL files, output violations in this exact format, one per line:

[rule-id] file:line - description

If no violations are found across all files, respond with exactly: No violations found.

## Constraints

- ONLY flag code on "+" lines (added code). NEVER flag removed or unchanged lines.
- Every violation MUST cite a rule ID from the provided rules. Do not invent rules.
- Be certain before flagging. False positives waste developer time. If uncertain, skip.
- Be concise. No preamble, no summary, no explanation beyond the violation format.
- When a file's diff says "No diff available", skip that file entirely.`;

export async function runReviewAgent(options: RunReviewOptions): Promise<ReviewResult> {
  const filesPerWorker = ensurePositiveInteger(options.filesPerWorker, DEFAULT_FILES_PER_WORKER, 'files_per_worker');
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
          diffs: options.diffs,
          filesWithRules: group,
          codebaseContext: options.codebaseContext,
        });

        if (options.verbose) {
          console.log(chalk.gray(`Worker ${workerLabel} sent (${prompt.length} chars)`));
        }

        return generateText({
          model: options.model,
          system: SYSTEM_PROMPT,
          prompt,
          tools: {
            read_file: tool({
              description:
                'Read the contents of a file in the repository. Use this when the Codebase Map shows a relevant dependency and a rule requires understanding cross-file behavior.',
              inputSchema: z.object({
                path: z.string().describe('Repo-relative file path (e.g., "src/lib/math.ts")'),
              }),
              execute: async ({ path: filePath }) => {
                try {
                  const absolutePath = path.resolve(process.cwd(), filePath);

                  // Safety: prevent path traversal outside repo
                  if (!absolutePath.startsWith(process.cwd())) {
                    return 'Error: path is outside the repository.';
                  }

                  const content = fs.readFileSync(absolutePath, 'utf-8');
                  if (content.length > 10_000) {
                    return `${content.slice(0, 10_000)}\n[file truncated at 10,000 characters]`;
                  }
                  return content;
                } catch (error) {
                  const message = error instanceof Error ? error.message : String(error);
                  return `Error reading file: ${message}`;
                }
              },
            }),
          },
          stopWhen: stepCountIs(10),
        }).then((result) => {
          completedCount++;
          spinner.setMessage(`Processing review... ${completedCount}/${fileGroups.length} worker(s) complete`);
          spinner.log(chalk.green(`✓ Worker ${workerLabel} complete`));
          return result;
        });
      })
    );

    spinner.stop();

    // Collect text from ALL steps — result.text only returns the last step's text
    const texts = results.map((r) =>
      r.steps
        .map((s) => s.text)
        .filter(Boolean)
        .join('\n')
    );

    if (options.verbose) {
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const toolCalls = result.steps.flatMap((s) => s.toolCalls);
        if (toolCalls.length > 0) {
          console.log(chalk.gray(`Worker ${i + 1}/${results.length} made ${toolCalls.length} tool call(s):`));
          for (const tc of toolCalls) {
            if (!tc.dynamic) {
              console.log(chalk.gray(`  read_file: ${tc.input.path}`));
            }
          }
        }
      }
    }

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
