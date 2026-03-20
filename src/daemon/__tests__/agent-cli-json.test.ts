/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { parseAgentJsonOutput } from '../agent-cli.js';

describe('parseAgentJsonOutput', () => {
  test('parses valid JSON envelope', () => {
    const json = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '[error] src/app.ts:10 - SQL injection vulnerability',
      total_cost_usd: 0.05,
      usage: { input_tokens: 1000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      num_turns: 3,
    });
    const output = parseAgentJsonOutput(json);
    expect(output.text).toBe('[error] src/app.ts:10 - SQL injection vulnerability');
    expect(output.usage?.costUsd).toBe(0.05);
    expect(output.usage?.inputTokens).toBe(1000);
    expect(output.usage?.outputTokens).toBe(200);
    expect(output.usage?.numTurns).toBe(3);
  });

  test('handles missing usage fields gracefully', () => {
    const json = JSON.stringify({ type: 'result', result: 'No issues found' });
    const output = parseAgentJsonOutput(json);
    expect(output.text).toBe('No issues found');
    expect(output.usage).toBeUndefined();
  });

  test('returns raw text when JSON parsing fails', () => {
    const output = parseAgentJsonOutput('This is not JSON at all');
    expect(output.text).toBe('This is not JSON at all');
    expect(output.usage).toBeUndefined();
  });

  test('returns empty text when result field is missing', () => {
    const json = JSON.stringify({ type: 'result', subtype: 'error' });
    const output = parseAgentJsonOutput(json);
    expect(output.text).toBe('');
    expect(output.usage).toBeUndefined();
  });

  test('captures token usage when total_cost_usd is missing (subscription)', () => {
    const json = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: 'No issues found',
      usage: { input_tokens: 5000, output_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      num_turns: 2,
    });
    const output = parseAgentJsonOutput(json);
    expect(output.text).toBe('No issues found');
    expect(output.usage).toBeDefined();
    expect(output.usage!.costUsd).toBe(0);
    expect(output.usage!.inputTokens).toBe(5000);
    expect(output.usage!.outputTokens).toBe(1200);
    expect(output.usage!.numTurns).toBe(2);
  });

  test('extracts result from verbose JSON array (--verbose mode)', () => {
    const json = JSON.stringify([
      { type: 'system', subtype: 'init', session_id: 'abc' },
      { type: 'assistant', message: { content: [{ type: 'text', text: '4' }] } },
      {
        type: 'result',
        subtype: 'success',
        result: '[error] src/db.ts:5 - missing index',
        total_cost_usd: 0.031,
        usage: { input_tokens: 2000, output_tokens: 500 },
        num_turns: 1,
      },
    ]);
    const output = parseAgentJsonOutput(json);
    expect(output.text).toBe('[error] src/db.ts:5 - missing index');
    expect(output.usage).toBeDefined();
    expect(output.usage!.costUsd).toBe(0.031);
    expect(output.usage!.inputTokens).toBe(2000);
    expect(output.usage!.outputTokens).toBe(500);
  });

  test('returns empty text when verbose array has no result event', () => {
    const json = JSON.stringify([
      { type: 'system', subtype: 'init' },
      { type: 'assistant', message: {} },
    ]);
    const output = parseAgentJsonOutput(json);
    expect(output.text).toBe('');
    expect(output.usage).toBeUndefined();
  });

  test('captures token usage when total_cost_usd is zero (subscription)', () => {
    const json = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: '[warning] file.ts:1 - unused import',
      total_cost_usd: 0,
      usage: { input_tokens: 3000, output_tokens: 800 },
      num_turns: 1,
    });
    const output = parseAgentJsonOutput(json);
    expect(output.usage).toBeDefined();
    expect(output.usage!.costUsd).toBe(0);
    expect(output.usage!.inputTokens).toBe(3000);
    expect(output.usage!.outputTokens).toBe(800);
  });
});
