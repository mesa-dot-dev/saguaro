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

describe('createSkillAdapter scope resolution', () => {
  test('creates skill in scoped directory when scope is provided', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        scope: 'packages/web',
        title: 'No Console Log',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Do not use console.log',
        repoRoot: root,
      });

      const expectedSkillsDir = path.join(root, 'packages/web', '.claude', 'skills');
      expect(result.skillsDir).toBe(expectedSkillsDir);
      expect(result.skillDir.startsWith(expectedSkillsDir)).toBe(true);
      expect(fs.existsSync(result.skillFilePath)).toBe(true);
      expect(fs.existsSync(result.policyFilePath)).toBe(true);
    });
  });

  test('auto-creates .claude/skills directory under scope', () => {
    withTempRepo((root) => {
      const scopedSkillsDir = path.join(root, 'packages/web', '.claude', 'skills');
      expect(fs.existsSync(scopedSkillsDir)).toBe(false);

      createSkillAdapter({
        scope: 'packages/web',
        title: 'Test Rule',
        severity: 'error',
        globs: ['**/*.tsx'],
        instructions: 'Test instructions',
        repoRoot: root,
      });

      expect(fs.existsSync(scopedSkillsDir)).toBe(true);
    });
  });

  test('defaults to repo root .claude/skills when no scope provided', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        title: 'Root Rule',
        severity: 'info',
        globs: ['**/*.ts'],
        instructions: 'Root instructions',
        repoRoot: root,
      });

      const expectedSkillsDir = path.join(root, '.claude', 'skills');
      expect(result.skillsDir).toBe(expectedSkillsDir);
      expect(result.skillDir.startsWith(expectedSkillsDir)).toBe(true);
      expect(fs.existsSync(result.skillFilePath)).toBe(true);
      expect(fs.existsSync(result.policyFilePath)).toBe(true);
    });
  });
});

describe('createSkillAdapter rich SKILL.md', () => {
  test('writes SKILL.md with instruction sections when policy has examples', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        scope: 'packages/web',
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

      const skillContent = fs.readFileSync(result.skillFilePath, 'utf-8');

      // Should contain actual instructions
      expect(skillContent).toContain('What to Look For');
      expect(skillContent).toContain('Why This Matters');
      // Should contain violation examples
      expect(skillContent).toContain("console.log('debug')");
      // Should contain compliant examples
      expect(skillContent).toContain("logger.info('debug')");
      // Should have frontmatter
      expect(skillContent).toContain('name: no-console-log');
      // Should have rule header
      expect(skillContent).toContain('## Rule: No Console Log');
      expect(skillContent).toContain('**Severity:** warning');
    });
  });

  test('writes SKILL.md with policy file reference', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        scope: 'packages/web',
        title: 'Test Rule',
        severity: 'error',
        globs: ['**/*.ts'],
        instructions: 'Test instructions',
        repoRoot: root,
      });

      const skillContent = fs.readFileSync(result.skillFilePath, 'utf-8');
      expect(skillContent).toContain('references/mesa-policy.yaml');
    });
  });

  test('writes SKILL.md without examples section when none provided', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        scope: 'packages/web',
        title: 'Simple Rule',
        severity: 'info',
        globs: ['**/*.ts'],
        instructions: 'Simple instructions here',
        repoRoot: root,
      });

      const skillContent = fs.readFileSync(result.skillFilePath, 'utf-8');
      expect(skillContent).toContain('Simple instructions here');
      expect(skillContent).toContain('## Rule: Simple Rule');
      expect(skillContent).not.toContain('### Violations');
      expect(skillContent).not.toContain('### Compliant');
    });
  });

  test('includes examples in policy YAML when provided', () => {
    withTempRepo((root) => {
      const result = createSkillAdapter({
        scope: 'packages/web',
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

      const yamlContent = fs.readFileSync(result.policyFilePath, 'utf-8');
      expect(yamlContent).toContain('bad()');
      expect(yamlContent).toContain('good()');
    });
  });
});
