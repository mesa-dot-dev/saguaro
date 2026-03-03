import fs from 'node:fs';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import { generateText, stepCountIs, tool } from 'ai';
import chalk from 'chalk';
import { z } from 'zod';
import type { ReviewProgressCallback, ReviewResult, RulePolicy } from '../types/types.js';
import { logger } from '../util/logger.js';
import { countRules, splitFilesForWorkers } from '../util/review-utils.js';
import type { ParseViolationsResult } from './parser.js';
import { deduplicateViolations, parseViolationsDetailed } from './parser.js';
import { buildPrompt, SYSTEM_PROMPT } from './prompt.js';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'claude-opus-4-6': { inputPerMillion: 5, outputPerMillion: 25 },
  'claude-sonnet-4-6': { inputPerMillion: 3, outputPerMillion: 15 },
};

export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number | undefined {
  const pricing = MODEL_PRICING[modelId];
  if (!pricing) return undefined;
  return (inputTokens / 1_000_000) * pricing.inputPerMillion + (outputTokens / 1_000_000) * pricing.outputPerMillion;
}

export interface RunReviewOptions {
  filesWithRules: Map<string, RulePolicy[]>;
  diffs: Map<string, string>;
  model: LanguageModel;
  filesPerWorker?: number;
  maxSteps: number;
  verbose?: boolean;
  onProgress?: ReviewProgressCallback;
  /** Markdown section with import graph + blast radius context from the codebase indexer */
  codebaseContext?: string;
  /** Resolves a repo-relative file path to its content. Used by the read_file tool and line snapping. */
  resolveFile?: (path: string) => string | null;
  /** Signal to abort in-flight LLM requests (e.g. on SIGINT) */
  abortSignal?: AbortSignal;
  /** The model identifier string (e.g. "claude-opus-4-6") for cost estimation */
  modelId?: string;
}

const DEFAULT_FILES_PER_WORKER = 3;

export async function runReviewAgent(options: RunReviewOptions): Promise<ReviewResult> {
  const runStartedAtMs = Date.now();
  const resolveFile = options.resolveFile ?? createDefaultFileResolver();
  const emitProgress = (event: Parameters<ReviewProgressCallback>[0]): void => {
    try {
      options.onProgress?.(event);
    } catch (err) {
      logger.debug(chalk.gray(`[debug] Progress callback error: ${err instanceof Error ? err.message : String(err)}`));
    }
  };
  const filesPerWorker = ensurePositiveInteger(options.filesPerWorker, DEFAULT_FILES_PER_WORKER, 'files_per_batch');
  const maxSteps = options.maxSteps;
  const fileGroups = splitFilesForWorkers(options.filesWithRules, filesPerWorker);

  logger.debug(chalk.gray(`[debug] Review config: filesPerWorker=${filesPerWorker}, maxSteps=${maxSteps}`));
  logger.debug(chalk.gray(`[debug] System prompt (${SYSTEM_PROMPT.length} chars):\n${SYSTEM_PROMPT}\n`));

  emitProgress({
    type: 'run_split',
    totalFiles: options.filesWithRules.size,
    totalWorkers: fileGroups.length,
  });

  const totalWorkers = fileGroups.length;
  const parseResults: WorkerParseViolationsResult[] = await Promise.all(
    fileGroups.map(async (group, index) => {
      const workerIndex = index + 1;
      const workerStartedAtMs = Date.now();
      const prompt = buildPrompt({
        diffs: options.diffs,
        filesWithRules: group,
        codebaseContext: options.codebaseContext,
      });

      logger.debug(
        chalk.gray(`\n[debug] Worker ${workerIndex}/${totalWorkers} prompt (${prompt.length} chars):\n${prompt}\n`)
      );

      emitProgress({
        type: 'worker_started',
        workerIndex,
        totalWorkers,
        promptChars: prompt.length,
      });

      const emittedToolCallKeys = new Set<string>();
      let toolCalls = 0;

      const result = await generateText({
        model: options.model,
        system: SYSTEM_PROMPT,
        prompt,
        abortSignal: options.abortSignal,
        tools: {
          read_file: tool({
            description:
              'Read the contents of a file in the repository. Use this when the Codebase Map shows a relevant connection or when you need to inspect a file imported by the changed code.',
            inputSchema: z.object({
              path: z.string().describe('Repo-relative file path (e.g., "src/lib/math.ts")'),
            }),
            execute: async ({ path: filePath }) => {
              try {
                const content = resolveFile(filePath);
                if (content === null) {
                  return `Error reading file: file not found or unreadable`;
                }
                if (content.length > 10000) {
                  return `${content.slice(0, 10000)}\n[file truncated at 10,000 characters]`;
                }
                return content;
              } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return `Error reading file: ${message}`;
              }
            },
          }),
        },
        stopWhen: stepCountIs(maxSteps),
        onStepFinish: ({ toolCalls: stepToolCalls }) => {
          const extractedToolCalls = extractToolCalls(stepToolCalls);

          for (const toolCall of extractedToolCalls) {
            const key = getToolCallKey(toolCall);
            if (emittedToolCallKeys.has(key)) {
              continue;
            }

            emittedToolCallKeys.add(key);
            toolCalls += 1;
            emitProgress({
              type: 'tool_call',
              workerIndex,
              totalWorkers,
              toolName: toolCall.toolName,
              path: toolCall.path,
            });
          }
        },
      });

      emitProgress({
        type: 'worker_completed',
        workerIndex,
        totalWorkers,
        toolCalls,
        durationMs: Date.now() - workerStartedAtMs,
      });

      const text = result.steps
        .map((step) => step.text)
        .filter(Boolean)
        .join('\n');

      logger.debug(
        chalk.gray(
          `\n[debug] Worker ${workerIndex}/${totalWorkers} raw response (${text.length} chars, ${result.steps.length} steps):\n${text}\n`
        )
      );
      logger.debug(
        chalk.gray(
          `[debug] Worker ${workerIndex}/${totalWorkers} usage: input=${result.totalUsage.inputTokens ?? 0}, output=${result.totalUsage.outputTokens ?? 0}`
        )
      );

      const parsed = parseViolationsDetailed(text, options.filesWithRules, resolveFile);

      emitProgress({
        type: 'parse_summary',
        workerIndex,
        totalWorkers,
        matchedLines: parsed.matchedLines,
        ignoredLines: parsed.ignoredLines,
        violations: parsed.violations.length,
        shortCircuitedNoViolations: parsed.shortCircuitedNoViolations,
      });

      return {
        ...parsed,
        toolCalls,
        inputTokens: result.totalUsage.inputTokens ?? 0,
        outputTokens: result.totalUsage.outputTokens ?? 0,
      };
    })
  );

  const totalToolCalls = parseResults.reduce((count, result) => count + result.toolCalls, 0);
  const totalMatched = parseResults.reduce((count, result) => count + result.matchedLines, 0);
  const totalIgnored = parseResults.reduce((count, result) => count + result.ignoredLines, 0);
  const allViolations = deduplicateViolations(parseResults.flatMap((result) => result.violations));
  const totalInputTokens = parseResults.reduce((count, result) => count + result.inputTokens, 0);
  const totalOutputTokens = parseResults.reduce((count, result) => count + result.outputTokens, 0);

  emitProgress({
    type: 'run_summary',
    totalWorkers,
    totalToolCalls,
    totalMatched,
    totalIgnored,
    totalViolations: allViolations.length,
    durationMs: Date.now() - runStartedAtMs,
  });

  return {
    violations: allViolations,
    summary: {
      filesReviewed: options.filesWithRules.size,
      rulesChecked: countRules(options.filesWithRules),
      errors: allViolations.filter((v) => v.severity === 'error').length,
      warnings: allViolations.filter((v) => v.severity === 'warning').length,
      infos: allViolations.filter((v) => v.severity === 'info').length,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cost: options.modelId ? estimateCost(options.modelId, totalInputTokens, totalOutputTokens) : undefined,
    },
  };
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

interface WorkerParseViolationsResult extends ParseViolationsResult {
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
}

interface ExtractedToolCall {
  toolName: string;
  path?: string;
}

function extractToolCalls(toolCalls: unknown): ExtractedToolCall[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  const extracted: ExtractedToolCall[] = [];
  for (const rawToolCall of toolCalls) {
    const parsed = parseToolCall(rawToolCall);
    if (parsed) {
      extracted.push(parsed);
    }
  }

  return extracted;
}

function getToolCallKey(toolCall: ExtractedToolCall): string {
  return `${toolCall.toolName}::${toolCall.path ?? ''}`;
}

function parseToolCall(toolCall: unknown): ExtractedToolCall | null {
  if (!isRecord(toolCall)) {
    return null;
  }

  const toolName =
    typeof toolCall.toolName === 'string'
      ? toolCall.toolName
      : typeof toolCall.tool === 'string'
        ? toolCall.tool
        : 'unknown_tool';

  return {
    toolName,
    path: toolName === 'read_file' ? extractToolCallPath(toolCall) : undefined,
  };
}

function extractToolCallPath(toolCall: Record<string, unknown>): string | undefined {
  if (typeof toolCall.path === 'string') {
    return toolCall.path;
  }

  const nestedCandidates = [toolCall.input, toolCall.args, toolCall.arguments];
  for (const candidate of nestedCandidates) {
    if (!isRecord(candidate)) {
      continue;
    }

    if (typeof candidate.path === 'string') {
      return candidate.path;
    }
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createDefaultFileResolver(): (filePath: string) => string | null {
  const cache = new Map<string, string | null>();
  return (filePath: string) => {
    if (cache.has(filePath)) return cache.get(filePath)!;
    try {
      const absolutePath = path.resolve(process.cwd(), filePath);
      if (!absolutePath.startsWith(process.cwd())) {
        cache.set(filePath, null);
        return null;
      }
      const content = fs.readFileSync(absolutePath, 'utf-8');
      cache.set(filePath, content);
      return content;
    } catch {
      cache.set(filePath, null);
      return null;
    }
  };
}
