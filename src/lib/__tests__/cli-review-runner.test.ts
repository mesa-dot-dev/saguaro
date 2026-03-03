/// <reference types="bun-types" />

import { describe, expect, mock, test } from 'bun:test';
import type { AgentRunner, AgentRunnerOptions, AgentRunnerResult } from '../../core/types.js';
import type { ReviewProgressEvent, RulePolicy } from '../../types/types.js';
import { runCliReview } from '../cli-review-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<RulePolicy> = {}): RulePolicy {
  return {
    id: 'no-console',
    title: 'No Console Statements',
    severity: 'error',
    globs: ['**/*.ts'],
    instructions: 'Do not use console.log',
    ...overrides,
  };
}

function makeRunner(result: AgentRunnerResult | Error): AgentRunner {
  const executeFn = mock(async (_options: AgentRunnerOptions): Promise<AgentRunnerResult> => {
    if (result instanceof Error) {
      throw result;
    }
    return result;
  });
  return { execute: executeFn };
}

/** Build text-format violation output matching the SYSTEM_PROMPT format */
function textViolation(ruleId: string, file: string, line: number, message: string, snippet: string): string {
  return `[${ruleId}] ${file}:${line} - ${message} | \`${snippet}\``;
}

// ---------------------------------------------------------------------------
// runCliReview
// ---------------------------------------------------------------------------

describe('runCliReview', () => {
  test('returns violations from text output', async () => {
    const rule = makeRule({ id: 'no-console', title: 'No Console', severity: 'error' });
    const filesWithRules = new Map([['src/index.ts', [rule]]]);
    const diffs = new Map([['src/index.ts', '+ console.log("hi")']]);

    const runner = makeRunner({
      output: textViolation('no-console', 'src/index.ts', 5, 'console.log detected', 'console.log("hi")'),
      durationMs: 100,
    });

    const result = await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      runner,
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].ruleId).toBe('no-console');
    expect(result.violations[0].ruleTitle).toBe('No Console');
    expect(result.violations[0].severity).toBe('error');
    expect(result.summary.filesReviewed).toBe(1);
    expect(result.summary.rulesChecked).toBe(1);
    expect(result.summary.errors).toBe(1);
    expect(result.summary.warnings).toBe(0);
  });

  test('returns empty violations when no issues found', async () => {
    const rule = makeRule();
    const filesWithRules = new Map([['src/index.ts', [rule]]]);
    const diffs = new Map([['src/index.ts', '+ const x = 1;']]);

    const runner = makeRunner({
      output: 'No violations found.',
      durationMs: 50,
    });

    const result = await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      runner,
    });

    expect(result.violations).toHaveLength(0);
    expect(result.summary.errors).toBe(0);
    expect(result.summary.warnings).toBe(0);
    expect(result.summary.infos).toBe(0);
  });

  test('fails open when runner throws and reports failed files', async () => {
    const rule = makeRule();
    const filesWithRules = new Map([['src/index.ts', [rule]]]);
    const diffs = new Map([['src/index.ts', '+ const x = 1;']]);

    const runner = makeRunner(new Error('claude timed out after 300000ms'));

    const result = await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      runner,
    });

    // Fail open: no violations, no crash
    expect(result.violations).toHaveLength(0);
    expect(result.summary.errors).toBe(0);
    // But the failure is surfaced in the summary
    expect(result.summary.filesReviewed).toBe(0);
    expect(result.summary.failedFiles).toBe(1);
  });

  test('splits files into parallel workers based on filesPerWorker', async () => {
    const rule = makeRule();
    const filesWithRules = new Map([
      ['src/a.ts', [rule]],
      ['src/b.ts', [rule]],
      ['src/c.ts', [rule]],
      ['src/d.ts', [rule]],
      ['src/e.ts', [rule]],
    ]);
    const diffs = new Map([
      ['src/a.ts', '+ a'],
      ['src/b.ts', '+ b'],
      ['src/c.ts', '+ c'],
      ['src/d.ts', '+ d'],
      ['src/e.ts', '+ e'],
    ]);

    const executeCalls: string[][] = [];
    const runner: AgentRunner = {
      execute: mock(async (options: AgentRunnerOptions): Promise<AgentRunnerResult> => {
        // Capture which files are in the prompt
        const filesInPrompt: string[] = [];
        for (const file of filesWithRules.keys()) {
          if (options.prompt.includes(file)) {
            filesInPrompt.push(file);
          }
        }
        executeCalls.push(filesInPrompt);
        return { output: 'No violations found.', durationMs: 50 };
      }),
    };

    await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      filesPerWorker: 2,
      runner,
    });

    // 5 files / 2 per worker = 3 workers
    expect(executeCalls).toHaveLength(3);
    expect(executeCalls[0]).toHaveLength(2); // [a, b]
    expect(executeCalls[1]).toHaveLength(2); // [c, d]
    expect(executeCalls[2]).toHaveLength(1); // [e]
  });

  test('deduplicates violations across workers', async () => {
    const rule = makeRule({ id: 'no-console', title: 'No Console', severity: 'error' });
    const filesWithRules = new Map([
      ['src/a.ts', [rule]],
      ['src/b.ts', [rule]],
    ]);
    const diffs = new Map([
      ['src/a.ts', '+ console.log("a")'],
      ['src/b.ts', '+ console.log("b")'],
    ]);

    // Both workers report the same violation for src/a.ts
    let callCount = 0;
    const runner: AgentRunner = {
      execute: mock(async (_options: AgentRunnerOptions): Promise<AgentRunnerResult> => {
        callCount++;
        return {
          output: textViolation('no-console', 'src/a.ts', 1, 'console.log detected', 'console.log("a")'),
          durationMs: 50,
        };
      }),
    };

    const result = await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      filesPerWorker: 1,
      runner,
    });

    // Two workers ran
    expect(callCount).toBe(2);
    // But the duplicate violation should be deduped
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].ruleId).toBe('no-console');
    expect(result.violations[0].file).toBe('src/a.ts');
  });

  test('passes model, cwd, abortSignal, and allowedTools to runner', async () => {
    const rule = makeRule();
    const filesWithRules = new Map([['src/a.ts', [rule]]]);
    const diffs = new Map([['src/a.ts', '+ x']]);
    const controller = new AbortController();

    let capturedOptions: AgentRunnerOptions | undefined;
    const runner: AgentRunner = {
      execute: mock(async (options: AgentRunnerOptions): Promise<AgentRunnerResult> => {
        capturedOptions = options;
        return { output: 'No violations found.', durationMs: 50 };
      }),
    };

    await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/my/project',
      model: 'claude-sonnet-4-6',
      abortSignal: controller.signal,
      runner,
    });

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!.cwd).toBe('/my/project');
    expect(capturedOptions!.model).toBe('claude-sonnet-4-6');
    expect(capturedOptions!.abortSignal).toBe(controller.signal);
    expect(capturedOptions!.allowedTools).toEqual(['Read']);
  });

  test('emits progress events', async () => {
    const rule = makeRule();
    const filesWithRules = new Map([['src/a.ts', [rule]]]);
    const diffs = new Map([['src/a.ts', '+ x']]);

    const runner = makeRunner({ output: 'No violations found.', durationMs: 50 });

    const events: ReviewProgressEvent[] = [];
    await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      runner,
      onProgress: (event: ReviewProgressEvent) => events.push(event),
    });

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('run_split');
    expect(eventTypes).toContain('worker_started');
    expect(eventTypes).toContain('worker_completed');
    expect(eventTypes).toContain('run_summary');
  });

  test('parses multiple violations from text output', async () => {
    const rule1 = makeRule({ id: 'no-console', title: 'No Console', severity: 'error' });
    const rule2 = makeRule({ id: 'no-todo', title: 'No TODOs', severity: 'warning' });
    const filesWithRules = new Map([['src/index.ts', [rule1, rule2]]]);
    const diffs = new Map([['src/index.ts', '+ console.log("hi")\n+ // TODO: fix this']]);

    const output = [
      textViolation('no-console', 'src/index.ts', 5, 'console.log detected', 'console.log("hi")'),
      textViolation('no-todo', 'src/index.ts', 6, 'TODO comment found', '// TODO: fix this'),
    ].join('\n');

    const runner = makeRunner({ output, durationMs: 100 });

    const result = await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      runner,
    });

    expect(result.violations).toHaveLength(2);
    expect(result.violations[0].ruleId).toBe('no-console');
    expect(result.violations[0].severity).toBe('error');
    expect(result.violations[1].ruleId).toBe('no-todo');
    expect(result.violations[1].severity).toBe('warning');
    expect(result.summary.errors).toBe(1);
    expect(result.summary.warnings).toBe(1);
  });

  test('limits concurrent workers via maxConcurrency', async () => {
    const rule = makeRule();
    const filesWithRules = new Map([
      ['src/a.ts', [rule]],
      ['src/b.ts', [rule]],
      ['src/c.ts', [rule]],
      ['src/d.ts', [rule]],
      ['src/e.ts', [rule]],
      ['src/f.ts', [rule]],
    ]);
    const diffs = new Map([
      ['src/a.ts', '+ a'],
      ['src/b.ts', '+ b'],
      ['src/c.ts', '+ c'],
      ['src/d.ts', '+ d'],
      ['src/e.ts', '+ e'],
      ['src/f.ts', '+ f'],
    ]);

    let peakConcurrent = 0;
    let currentConcurrent = 0;

    const runner: AgentRunner = {
      execute: mock(async (_options: AgentRunnerOptions): Promise<AgentRunnerResult> => {
        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
        // Simulate async work so other workers can start
        await new Promise((resolve) => setTimeout(resolve, 10));
        currentConcurrent--;
        return { output: 'No violations found.', durationMs: 50 };
      }),
    };

    await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      filesPerWorker: 1,
      maxConcurrency: 2,
      runner,
    });

    // 6 files / 1 per worker = 6 workers, but max 2 concurrent
    expect(peakConcurrent).toBeLessThanOrEqual(2);
    expect(runner.execute).toHaveBeenCalledTimes(6);
  });

  test('handles fallback regex format (no snippet)', async () => {
    const rule = makeRule({ id: 'no-console', title: 'No Console', severity: 'error' });
    const filesWithRules = new Map([['src/index.ts', [rule]]]);
    const diffs = new Map([['src/index.ts', '+ console.log("hi")']]);

    // Fallback format: [rule-id] file:line - description (no snippet)
    const runner = makeRunner({
      output: '[no-console] src/index.ts:5 - console.log detected',
      durationMs: 100,
    });

    const result = await runCliReview({
      filesWithRules,
      diffs,
      cwd: '/tmp/test',
      runner,
    });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].ruleId).toBe('no-console');
    expect(result.violations[0].file).toBe('src/index.ts');
    expect(result.violations[0].line).toBe(5);
  });
});
