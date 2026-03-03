/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRulesForFiles } from './resolution.js';

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-rules-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeMesaRule(
  root: string,
  options: {
    id: string;
    title: string;
    severity: string;
    globs: string[];
    instructions: string;
    priority?: number;
  }
): void {
  const rulesDir = path.join(root, '.mesa', 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });

  const globLines = options.globs.map((g) => `  - ${JSON.stringify(g)}`).join('\n');
  const frontmatter = [
    '---',
    `id: ${options.id}`,
    `title: ${JSON.stringify(options.title)}`,
    `severity: ${options.severity}`,
    'globs:',
    globLines,
    ...(options.priority !== undefined ? [`priority: ${options.priority}`] : []),
    '---',
  ].join('\n');

  fs.writeFileSync(path.join(rulesDir, `${options.id}.md`), `${frontmatter}\n\n${options.instructions}\n`);
}

describe('rule resolution', () => {
  test('resolves rules from .mesa/rules/ and matches files by glob', () => {
    withTempRepo((root) => {
      writeMesaRule(root, {
        id: 'no-console-log',
        title: 'No console.log',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Do not use console.log',
      });

      const result = resolveRulesForFiles(['src/app.ts'], { startDir: root });
      const fileRules = result.filesWithRules.get('src/app.ts');

      expect(result.rulesLoaded).toBe(1);
      expect(fileRules).toBeDefined();
      expect(fileRules?.length).toBe(1);
      expect(fileRules?.[0]?.id).toBe('no-console-log');
      expect(fileRules?.[0]?.severity).toBe('warning');
    });
  });

  test('handles include and exclude globs for matching', () => {
    withTempRepo((root) => {
      writeMesaRule(root, {
        id: 'no-tests',
        title: 'No tests policy',
        severity: 'warning',
        globs: ['**/*.ts', '!**/*.test.ts'],
        instructions: 'source only',
      });

      const matched = resolveRulesForFiles(['src/service.ts'], { startDir: root });
      expect(matched.filesWithRules.get('src/service.ts')?.length).toBe(1);

      const excluded = resolveRulesForFiles(['src/service.test.ts'], { startDir: root });
      expect(excluded.filesWithRules.has('src/service.test.ts')).toBe(false);
    });
  });

  test('sorts matched rules by priority (higher first)', () => {
    withTempRepo((root) => {
      writeMesaRule(root, {
        id: 'low-priority',
        title: 'Low priority rule',
        severity: 'info',
        globs: ['**/*.ts'],
        instructions: 'low priority',
        priority: 1,
      });

      writeMesaRule(root, {
        id: 'high-priority',
        title: 'High priority rule',
        severity: 'error',
        globs: ['**/*.ts'],
        instructions: 'high priority',
        priority: 10,
      });

      const result = resolveRulesForFiles(['src/app.ts'], { startDir: root });
      const fileRules = result.filesWithRules.get('src/app.ts');

      expect(fileRules?.length).toBe(2);
      expect(fileRules?.[0]?.id).toBe('high-priority');
      expect(fileRules?.[1]?.id).toBe('low-priority');
    });
  });

  test('returns empty when no .mesa/rules/ directory exists', () => {
    withTempRepo((root) => {
      const result = resolveRulesForFiles(['src/app.ts'], { startDir: root });
      expect(result.rulesLoaded).toBe(0);
      expect(result.filesWithRules.size).toBe(0);
    });
  });
});
