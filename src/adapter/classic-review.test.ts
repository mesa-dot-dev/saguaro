/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { buildStaffEngineerPrompt, parseFindings } from '../daemon/prompt.js';

describe('classic review prompt integration', () => {
  test('builds prompt with diffs and parses empty findings', () => {
    const prompt = buildStaffEngineerPrompt({
      diffs: new Map([['src/index.ts', '+export const a = 1;']]),
      agentSummary: null,
    });
    expect(prompt).toContain('src/index.ts');
    expect(prompt).toContain('## Review Criteria');

    const findings = parseFindings('No issues found');
    expect(findings).toEqual([]);
  });

  test('builds prompt with custom criteria from config', () => {
    const prompt = buildStaffEngineerPrompt({
      diffs: new Map([['src/db.ts', '+await db.query(userInput);']]),
      agentSummary: 'Added database query',
      customCriteria: 'Only check for SQL injection.',
    });
    expect(prompt).toContain('Only check for SQL injection.');
    expect(prompt).toContain('Added database query');
    expect(prompt).not.toContain('## Review Criteria');
  });

  test('parses mixed severity findings', () => {
    const output = [
      '[error] src/db.ts:10 - SQL injection vulnerability via unsanitized userInput',
      '[warning] src/db.ts:15 - Unused variable `temp`',
    ].join('\n');
    const findings = parseFindings(output);
    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe('error');
    expect(findings[1].severity).toBe('warning');
  });
});
