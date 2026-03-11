/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuleAdapter } from './rules.js';

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saguaro-adapter-rules-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('createRuleAdapter centralized storage', () => {
  test('writes rule to .saguaro/rules/', () => {
    withTempRepo((root) => {
      const result = createRuleAdapter({
        title: 'No Console Log',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Do not use console.log',
        repoRoot: root,
      });

      expect(fs.existsSync(result.policyFilePath)).toBe(true);
      expect(result.policyFilePath).toContain('.saguaro/rules/');
    });
  });
});

describe('createRuleAdapter policy file', () => {
  test('policy file is markdown with YAML frontmatter in .saguaro/rules/', () => {
    withTempRepo((root) => {
      const result = createRuleAdapter({
        title: 'No Console Log',
        severity: 'warning',
        globs: ['src/**/*.ts'],
        instructions: '## What to Look For\nConsole.log calls\n\n## Why This Matters\nNoise in production',
        id: 'no-console-log',
        repoRoot: root,
        examples: {
          violations: ["console.log('debug')"],
          compliant: ["logger.info('debug')"],
        },
      });

      const policyContent = fs.readFileSync(result.policyFilePath, 'utf-8');

      expect(policyContent).toContain('id: no-console-log');
      expect(policyContent).toContain('title: No Console Log');
      expect(policyContent).toContain('severity: warning');
      expect(policyContent).toContain('What to Look For');
      expect(policyContent).toContain('Why This Matters');
      expect(policyContent).toContain("console.log('debug')");
      expect(policyContent).toContain("logger.info('debug')");
    });
  });

  test('policy file without examples omits example sections', () => {
    withTempRepo((root) => {
      const result = createRuleAdapter({
        title: 'Simple Rule',
        severity: 'info',
        globs: ['**/*.ts'],
        instructions: 'Simple instructions here',
        repoRoot: root,
      });

      const policyContent = fs.readFileSync(result.policyFilePath, 'utf-8');
      expect(policyContent).toContain('Simple instructions here');
      expect(policyContent).not.toContain('### Violations');
      expect(policyContent).not.toContain('### Compliant');
    });
  });

  test('includes examples in policy file when provided', () => {
    withTempRepo((root) => {
      const result = createRuleAdapter({
        title: 'With Examples',
        severity: 'error',
        globs: ['**/*.ts'],
        instructions: 'Test',
        repoRoot: root,
        examples: {
          violations: ['bad()'],
          compliant: ['good()'],
        },
      });

      const policyContent = fs.readFileSync(result.policyFilePath, 'utf-8');
      expect(policyContent).toContain('bad()');
      expect(policyContent).toContain('good()');
      expect(policyContent).toContain('### Violations');
      expect(policyContent).toContain('### Compliant');
    });
  });
});
