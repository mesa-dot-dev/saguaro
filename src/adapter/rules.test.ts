/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuleAdapter } from './rules.js';

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-adapter-rules-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('createRuleAdapter centralized storage', () => {
  test('writes rule to .mesa/rules/', () => {
    withTempRepo((root) => {
      const result = createRuleAdapter({
        title: 'No Console Log',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Do not use console.log',
        repoRoot: root,
      });

      expect(fs.existsSync(result.policyFilePath)).toBe(true);
      expect(result.policyFilePath).toContain('.mesa/rules/');
    });
  });

  test('generates single mesa-rules skill via sync', () => {
    withTempRepo((root) => {
      createRuleAdapter({
        title: 'No Console Log',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Do not use console.log',
        repoRoot: root,
      });

      const skillPath = path.join(root, '.claude', 'skills', 'mesa-rules', 'SKILL.md');
      expect(fs.existsSync(skillPath)).toBe(true);

      const content = fs.readFileSync(skillPath, 'utf-8');
      expect(content).toContain('name: mesa-rules');
      expect(content).toContain('mesa rules for');
    });
  });

  test('does not create per-rule skill directories', () => {
    withTempRepo((root) => {
      createRuleAdapter({
        title: 'Package Scoped Rule',
        severity: 'error',
        globs: ['packages/web/**/*.tsx'],
        instructions: 'Test instructions',
        repoRoot: root,
      });

      // Should NOT have a per-rule skill dir
      const perRuleDir = path.join(root, '.claude', 'skills', 'package-scoped-rule');
      expect(fs.existsSync(perRuleDir)).toBe(false);

      // Should have the single mesa-rules dir
      const mesaRulesDir = path.join(root, '.claude', 'skills', 'mesa-rules');
      expect(fs.existsSync(mesaRulesDir)).toBe(true);
    });
  });
});

describe('createRuleAdapter policy file', () => {
  test('policy file is markdown with YAML frontmatter in .mesa/rules/', () => {
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

  test('updates .gitignore with mesa-managed block for mesa-rules', () => {
    withTempRepo((root) => {
      createRuleAdapter({
        title: 'Gitignored Rule',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Test',
        repoRoot: root,
      });

      const gitignoreContent = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
      expect(gitignoreContent).toContain('# mesa-generated (do not edit this block)');
      expect(gitignoreContent).toContain('.claude/skills/mesa-rules/');
      expect(gitignoreContent).toContain('# end mesa-generated');
    });
  });
});
