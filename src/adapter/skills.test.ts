/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSkillAdapter } from './skills.js';

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-adapter-skills-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('createSkillAdapter centralized storage', () => {
  test('writes rule to .mesa/rules/ and generates .claude/skills/', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
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

  test('generates .claude/skills/<id>/ directory via sync', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        title: 'No Console Log',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Do not use console.log',
        repoRoot: root,
      });

      const expectedSkillDir = path.join(root, '.claude', 'skills', 'no-console-log');
      expect(result.skillDir).toBe(expectedSkillDir);
      expect(fs.existsSync(result.skillFilePath)).toBe(true);
    });
  });

  test('all rules go to .mesa/rules/ regardless of glob paths', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        title: 'Package Scoped Rule',
        severity: 'error',
        globs: ['packages/web/**/*.tsx'],
        instructions: 'Test instructions',
        repoRoot: root,
      });

      // Generated skill should be at root .claude/skills/
      expect(result.skillDir).toBe(path.join(root, '.claude', 'skills', 'package-scoped-rule'));
    });
  });
});

describe('createSkillAdapter SKILL.md and policy file', () => {
  test('SKILL.md references mesa-policy.yaml', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        title: 'Test Rule',
        severity: 'error',
        globs: ['**/*.ts'],
        instructions: 'Test instructions',
        repoRoot: root,
      });

      const skillContent = fs.readFileSync(result.skillFilePath, 'utf-8');
      expect(skillContent).toContain('references/mesa-policy.yaml');
      expect(skillContent).toContain('name: test-rule');
    });
  });

  test('policy file is markdown with YAML frontmatter in .mesa/rules/', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
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

      // Should have YAML frontmatter
      expect(policyContent).toContain('id: no-console-log');
      expect(policyContent).toContain('title: No Console Log');
      expect(policyContent).toContain('severity: warning');
      // Should contain instructions in the body
      expect(policyContent).toContain('What to Look For');
      expect(policyContent).toContain('Why This Matters');
      // Should contain examples
      expect(policyContent).toContain("console.log('debug')");
      expect(policyContent).toContain("logger.info('debug')");
    });
  });

  test('policy file without examples omits example sections', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
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
      const result = createSkillAdapter({
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

  test('updates .gitignore with mesa-managed block', () => {
    withTempRepo((root) => {
      createSkillAdapter({
        title: 'Gitignored Rule',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Test',
        repoRoot: root,
      });

      const gitignoreContent = fs.readFileSync(path.join(root, '.gitignore'), 'utf-8');
      expect(gitignoreContent).toContain('# mesa-generated (do not edit this block)');
      expect(gitignoreContent).toContain('.claude/skills/gitignored-rule/');
      expect(gitignoreContent).toContain('# end mesa-generated');
    });
  });
});
