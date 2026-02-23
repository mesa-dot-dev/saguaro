import fs from 'node:fs';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import { generateText, stepCountIs, tool } from 'ai';
import chalk from 'chalk';
import { z } from 'zod';
import type { ReviewProgressCallback, ReviewResult, RulePolicy, Violation } from '../types/types.js';
import { logger } from './logger.js';

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
  maxSteps?: number;
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
const MAX_DIFF_CHARS = 30000;

const SYSTEM_PROMPT = `You are a code review enforcement agent. Your ONLY job is to check whether new code changes violate the defined rules. You do not make suggestions, observations, or compliments. Silence means approval.

## Workflow

You will receive three sections of context in order:

1. **Codebase Map** — A lightweight map showing which files import from the changed files. Use this to know WHERE to look if a rule requires cross-file context, then use read_file to inspect.
2. **Files to Review** — Git diffs for each changed file with their applicable rules listed.
3. **Rules** — Full definitions of each rule including instructions and examples.

Follow this process:

### Phase 1: Orient
Read the Codebase Map. Understand which files are changed and which files import from them. This tells you who consumes the changed code.

### Phase 2: Review
For each file, read its diff. Check ONLY the added lines (lines prefixed with "+") against the applicable rules. Most violations can be identified from the diff alone.

### Phase 3: Investigate (only when needed)
Some rules require understanding cross-file behavior. The Codebase Map shows which files import from the changed code. When a rule requires cross-file context, use read_file to inspect the relevant file. If you need to understand a dependency (something the changed file imports from), the import path is visible in the diff — use read_file on it directly.

**When to use read_file:**
- The rule's instructions explicitly or implicitly require understanding code in another file
- The Codebase Map shows a file that imports from the changed code and you need to verify compatibility
- You need to see the implementation of an imported function to determine if a rule is violated

**When NOT to use read_file:**
- The diff alone is sufficient to check the rule
- The Codebase Map shows no relevant connections for the rule being checked
- You are curious but the rule doesn't require cross-file context

If no Codebase Map is provided, review using only the diffs. Do not speculatively search the codebase.

## Output

After reviewing ALL files, output violations in this exact format, one per line:

[rule-id] file:line - description | \`snippet\`

where \`snippet\` is a short (10-40 char) unique substring copied verbatim from the offending line.

If no violations are found across all files, respond with exactly: No violations found.

## Constraints

- ONLY flag code on "+" lines (added code). NEVER flag removed or unchanged lines.
- Every violation MUST cite a rule ID from the provided rules. Do not invent rules.
- Be certain before flagging. False positives waste developer time. If uncertain, skip.
- Be concise. No preamble, no summary, no explanation beyond the violation format.
- When a file's diff says "No diff available", skip that file entirely.`;

export function deduplicateViolations(violations: Violation[]): Violation[] {
  const seen = new Map<string, Violation>();
  for (const v of violations) {
    const key = `${v.ruleId}::${v.file}::${v.line ?? ''}`;
    if (!seen.has(key)) {
      seen.set(key, v);
    }
  }
  return Array.from(seen.values());
}

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
  const maxSteps = options.maxSteps ?? 10;
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

function splitFilesForWorkers(
  filesWithRules: Map<string, RulePolicy[]>,
  filesPerWorker: number
): Map<string, RulePolicy[]>[] {
  const entries = Array.from(filesWithRules.entries());
  const groups: Map<string, RulePolicy[]>[] = [];
  for (let i = 0; i < entries.length; i += filesPerWorker) {
    groups.push(new Map(entries.slice(i, i + filesPerWorker)));
  }
  return groups;
}

function countRules(filesWithRules: Map<string, RulePolicy[]>): number {
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

interface ParseViolationsResult {
  violations: Violation[];
  totalLines: number;
  matchedLines: number;
  ignoredLines: number;
  shortCircuitedNoViolations: boolean;
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

function snapLine(
  resolveFile: (path: string) => string | null,
  filePath: string,
  reportedLine: number,
  snippet: string,
  window = 10
): number {
  const content = resolveFile(filePath);
  if (!content) return reportedLine;

  const lines = content.split('\n');
  const start = Math.max(0, reportedLine - window - 1);
  const end = Math.min(lines.length, reportedLine + window);

  for (let i = start; i < end; i++) {
    if (lines[i].includes(snippet.trim())) return i + 1;
  }
  return reportedLine;
}

function parseViolationsDetailed(
  text: string,
  filesWithRules: Map<string, RulePolicy[]>,
  resolveFile: (path: string) => string | null
): ParseViolationsResult {
  const violations: Violation[] = [];
  if (!text) {
    return {
      violations,
      totalLines: 0,
      matchedLines: 0,
      ignoredLines: 0,
      shortCircuitedNoViolations: false,
    };
  }

  const rulesById = new Map<string, RulePolicy>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      if (!rulesById.has(rule.id)) {
        rulesById.set(rule.id, rule);
      }
    }
  }

  const SNIPPET_REGEX = /\[([^\]]+)\]\s+(\S+):(\d+)?\s*-\s*(.+?)\s*\|\s*`([^`]+)`/;
  const FALLBACK_REGEX = /\[([^\]]+)\]\s+(\S+):(\d+)?\s*-\s*(.+)/;

  const lines = text.split('\n');
  let matchedLines = 0;
  for (const line of lines) {
    const match = line.match(SNIPPET_REGEX) ?? line.match(FALLBACK_REGEX);
    if (match) {
      matchedLines++;
      const ruleId = match[1];
      const rule = rulesById.get(ruleId);
      const reportedLine = match[3] ? parseInt(match[3], 10) : undefined;
      const snippet = match[5]; // undefined if FALLBACK_REGEX matched
      const message = snippet ? match[4] : match[4].replace(/\s*\|\s*`[^`]*`\s*$/, '');

      violations.push({
        ruleId,
        ruleTitle: rule?.title ?? ruleId,
        severity: rule?.severity ?? 'error',
        file: match[2],
        line:
          reportedLine !== undefined && snippet ? snapLine(resolveFile, match[2], reportedLine, snippet) : reportedLine,
        message,
      });
    }
  }

  const shortCircuitedNoViolations = violations.length === 0 && isNoViolationsSentinel(text);

  return {
    violations,
    totalLines: lines.length,
    matchedLines,
    ignoredLines: shortCircuitedNoViolations ? lines.length : Math.max(0, lines.length - matchedLines),
    shortCircuitedNoViolations,
  };
}

function isNoViolationsSentinel(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === 'no violations found' || normalized === 'no violations found.';
}

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) {
    return diff;
  }

  return `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated]`;
}

function buildPrompt(options: {
  diffs: Map<string, string>;
  filesWithRules: Map<string, RulePolicy[]>;
  codebaseContext?: string;
}): string {
  const lines: string[] = [];

  if (options.codebaseContext) {
    lines.push(options.codebaseContext);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('## Files to Review');
  lines.push('');

  for (const [file, rules] of options.filesWithRules) {
    const ruleList = rules.map((rule) => `${rule.id} (${rule.severity})`).join(', ');
    lines.push(`### ${file}`);
    lines.push(`Applicable rules: ${ruleList}`);

    const diff = options.diffs.get(file);
    if (diff) {
      lines.push('```diff');
      lines.push(truncateDiff(diff));
      lines.push('```');
    } else {
      lines.push('No diff available for this file.');
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Rules');
  lines.push('');

  const uniqueRules = new Set<RulePolicy>(Array.from(options.filesWithRules.values()).flat());
  for (const rule of uniqueRules) {
    lines.push(formatRule(rule));
    lines.push('');
  }

  return lines.join('\n');
}

function formatRule(rule: RulePolicy): string {
  const lines: string[] = [
    `### Rule ID: ${rule.id}`,
    `**Severity:** ${rule.severity}`,
    `**Applies to:** ${rule.globs.join(', ')}`,
    '',
    rule.instructions,
  ];

  if (rule.examples) {
    if (rule.examples.violations?.length) {
      lines.push('');
      lines.push('**Violations:**');
      for (const v of rule.examples.violations) {
        lines.push('```');
        lines.push(v);
        lines.push('```');
      }
    }
    if (rule.examples.compliant?.length) {
      lines.push('');
      lines.push('**Compliant:**');
      for (const c of rule.examples.compliant) {
        lines.push('```');
        lines.push(c);
        lines.push('```');
      }
    }
  }

  return lines.join('\n');
}
