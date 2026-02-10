import fs from 'node:fs';
import path from 'node:path';
import type { LanguageModel } from 'ai';
import { generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import type { ReviewProgressCallback, ReviewResult, Rule, Violation } from '../types/types.js';

export interface RunReviewOptions {
  filesWithRules: Map<string, Rule[]>;
  diffs: Map<string, string>;
  model: LanguageModel;
  filesPerWorker?: number;
  verbose?: boolean;
  onProgress?: ReviewProgressCallback;
  /** Markdown section with import graph + blast radius context from the codebase indexer */
  codebaseContext?: string;
}

const DEFAULT_FILES_PER_WORKER = 3;
const MAX_DIFF_CHARS = 30_000;

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
  void options.verbose;
  const runStartedAtMs = Date.now();
  const emitProgress = (event: Parameters<ReviewProgressCallback>[0]): void => {
    try {
      options.onProgress?.(event);
    } catch {}
  };
  const filesPerWorker = ensurePositiveInteger(options.filesPerWorker, DEFAULT_FILES_PER_WORKER, 'files_per_worker');
  const fileGroups = splitFilesForWorkers(options.filesWithRules, filesPerWorker);

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

      const parsed = parseViolationsDetailed(text, options.filesWithRules);

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
      };
    })
  );

  const totalToolCalls = parseResults.reduce((count, result) => count + result.toolCalls, 0);
  const totalMatched = parseResults.reduce((count, result) => count + result.matchedLines, 0);
  const totalIgnored = parseResults.reduce((count, result) => count + result.ignoredLines, 0);
  const allViolations = parseResults.flatMap((result) => result.violations);

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
    },
  };
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

interface ParseViolationsResult {
  violations: Violation[];
  totalLines: number;
  matchedLines: number;
  ignoredLines: number;
  shortCircuitedNoViolations: boolean;
}

interface WorkerParseViolationsResult extends ParseViolationsResult {
  toolCalls: number;
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

function parseViolationsDetailed(text: string, filesWithRules: Map<string, Rule[]>): ParseViolationsResult {
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

  const rulesById = new Map<string, Rule>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      if (!rulesById.has(rule.id)) {
        rulesById.set(rule.id, rule);
      }
    }
  }

  const lines = text.split('\n');
  let matchedLines = 0;
  for (const line of lines) {
    const match = line.match(/\[([^\]]+)\]\s+(\S+):(\d+)?\s*-\s*(.+)/);
    if (match) {
      matchedLines++;
      const ruleId = match[1];
      const rule = rulesById.get(ruleId);
      violations.push({
        ruleId,
        ruleTitle: rule?.title ?? ruleId,
        severity: rule?.severity ?? 'error',
        file: match[2],
        line: match[3] ? parseInt(match[3], 10) : undefined,
        message: match[4],
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
  filesWithRules: Map<string, Rule[]>;
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

  const uniqueRules = new Set<Rule>(Array.from(options.filesWithRules.values()).flat());
  for (const rule of uniqueRules) {
    lines.push(formatRule(rule));
    lines.push('');
  }

  return lines.join('\n');
}

function formatRule(rule: Rule): string {
  const lines: string[] = [
    `### Rule ID: ${rule.id}`,
    `**Severity:** ${rule.severity}`,
    `**Applies to:** ${rule.globs.join(', ')}`,
    '',
    rule.instructions,
  ];

  if (rule.examples) {
    lines.push('');
    if (rule.examples.violations?.length) {
      lines.push(`**Violations:** ${rule.examples.violations.join(', ')}`);
    }
    if (rule.examples.compliant?.length) {
      lines.push(`**Compliant:** ${rule.examples.compliant.join(', ')}`);
    }
  }

  return lines.join('\n');
}
