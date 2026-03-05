/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { buildStaffEngineerPrompt, parseFindings, stripDiffContext } from '../prompt.js';

describe('buildStaffEngineerPrompt', () => {
  test('includes default review criteria when no customCriteria provided', () => {
    const diffs = new Map([['src/index.ts', '+const x = 1;']]);
    const prompt = buildStaffEngineerPrompt({ diffs, agentSummary: null });

    expect(prompt).toContain('## Review Criteria');
    expect(prompt).toContain('## Do NOT flag');
    expect(prompt).toContain('**Bugs**');
    expect(prompt).toContain('**Security**');
    expect(prompt).not.toContain('## Custom Review Criteria');
  });

  test('replaces default criteria with custom criteria when provided', () => {
    const diffs = new Map([['src/index.ts', '+const x = 1;']]);
    const customCriteria = 'Only check for SQL injection vulnerabilities.';
    const prompt = buildStaffEngineerPrompt({ diffs, agentSummary: null, customCriteria });

    expect(prompt).toContain('## Custom Review Criteria');
    expect(prompt).toContain(customCriteria);
    expect(prompt).not.toContain('## Review Criteria');
    expect(prompt).not.toContain('## Do NOT flag');
  });

  test('includes agent summary when provided', () => {
    const diffs = new Map([['src/index.ts', '+const x = 1;']]);
    const prompt = buildStaffEngineerPrompt({ diffs, agentSummary: 'Refactored auth module' });

    expect(prompt).toContain('The developer described their work as:');
    expect(prompt).toContain('"Refactored auth module"');
  });

  test('omits agent summary section when null', () => {
    const diffs = new Map([['src/index.ts', '+const x = 1;']]);
    const prompt = buildStaffEngineerPrompt({ diffs, agentSummary: null });

    expect(prompt).not.toContain('The developer described their work as:');
  });

  test('includes diffs in output', () => {
    const diffs = new Map([
      ['src/a.ts', '+line1'],
      ['src/b.ts', '-line2'],
    ]);
    const prompt = buildStaffEngineerPrompt({ diffs, agentSummary: null });

    expect(prompt).toContain('### src/a.ts');
    expect(prompt).toContain('+line1');
    expect(prompt).toContain('### src/b.ts');
    expect(prompt).toContain('-line2');
  });

  test('always includes output format section', () => {
    const diffs = new Map([['src/index.ts', '+const x = 1;']]);
    const prompt = buildStaffEngineerPrompt({ diffs, agentSummary: null, customCriteria: 'custom' });

    expect(prompt).toContain('## Output Format');
    expect(prompt).toContain('[severity] file:line - description');
    expect(prompt).toContain('No issues found');
  });
});

describe('parseFindings', () => {
  test('returns empty array for "No issues found"', () => {
    expect(parseFindings('No issues found')).toEqual([]);
  });

  test('returns empty array for "No issues found."', () => {
    expect(parseFindings('No issues found.')).toEqual([]);
  });

  test('parses error finding with line number', () => {
    const output = '[error] src/index.ts:42 - Null pointer dereference';
    const findings = parseFindings(output);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      file: 'src/index.ts',
      line: 42,
      message: 'Null pointer dereference',
      severity: 'error',
    });
  });

  test('parses warning finding with line number', () => {
    const output = '[warning] src/utils.ts:10 - Unused variable';
    const findings = parseFindings(output);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      file: 'src/utils.ts',
      line: 10,
      message: 'Unused variable',
      severity: 'warning',
    });
  });

  test('parses finding without line number', () => {
    const output = '[error] src/index.ts - Missing error handling';
    const findings = parseFindings(output);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({
      file: 'src/index.ts',
      line: null,
      message: 'Missing error handling',
      severity: 'error',
    });
  });

  test('parses multiple findings', () => {
    const output = ['[error] src/a.ts:1 - Bug in logic', '[warning] src/b.ts:2 - Performance issue'].join('\n');
    const findings = parseFindings(output);

    expect(findings).toHaveLength(2);
    expect(findings[0].severity).toBe('error');
    expect(findings[1].severity).toBe('warning');
  });

  test('deduplicates identical findings', () => {
    const output = ['[error] src/a.ts:1 - Same issue', '[error] src/a.ts:1 - Same issue'].join('\n');
    const findings = parseFindings(output);

    expect(findings).toHaveLength(1);
  });

  test('ignores non-matching lines', () => {
    const output = ['Here is my review:', '[error] src/a.ts:1 - Real issue', 'Some other commentary', ''].join('\n');
    const findings = parseFindings(output);

    expect(findings).toHaveLength(1);
    expect(findings[0].message).toBe('Real issue');
  });

  test('ignores unknown severity levels', () => {
    const output = '[info] src/a.ts:1 - Just informational';
    const findings = parseFindings(output);

    expect(findings).toHaveLength(0);
  });
});

describe('stripDiffContext', () => {
  test('strips unchanged context lines', () => {
    const diff = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1,5 +1,5 @@',
      ' unchanged line 1',
      '-removed line',
      '+added line',
      ' unchanged line 2',
      ' unchanged line 3',
    ].join('\n');

    const result = stripDiffContext(diff);
    const lines = result.split('\n');

    expect(lines).toContain('diff --git a/src/index.ts b/src/index.ts');
    expect(lines).toContain('--- a/src/index.ts');
    expect(lines).toContain('+++ b/src/index.ts');
    expect(lines).toContain('@@ -1,5 +1,5 @@');
    expect(lines).toContain('-removed line');
    expect(lines).toContain('+added line');
    expect(lines).not.toContain(' unchanged line 1');
    expect(lines).not.toContain(' unchanged line 2');
    expect(lines).not.toContain(' unchanged line 3');
  });

  test('keeps new file and deleted file markers', () => {
    const diff = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,3 @@',
      '+line 1',
      '+line 2',
    ].join('\n');

    const result = stripDiffContext(diff);

    expect(result).toContain('new file mode 100644');
    expect(result).toContain('+line 1');
    expect(result).toContain('+line 2');
  });

  test('keeps rename markers', () => {
    const diff = ['diff --git a/old.ts b/new.ts', 'rename from old.ts', 'rename to new.ts'].join('\n');

    const result = stripDiffContext(diff);

    expect(result).toContain('rename from old.ts');
    expect(result).toContain('rename to new.ts');
  });

  test('keeps deleted file markers', () => {
    const diff = [
      'diff --git a/removed.ts b/removed.ts',
      'deleted file mode 100644',
      '--- a/removed.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-line 1',
      '-line 2',
    ].join('\n');

    const result = stripDiffContext(diff);

    expect(result).toContain('deleted file mode 100644');
    expect(result).toContain('-line 1');
    expect(result).toContain('-line 2');
  });
});
