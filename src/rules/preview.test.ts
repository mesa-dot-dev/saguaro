/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { previewRule } from './preview.js';

function withTempDir(run: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saguaro-preview-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('previewRule', () => {
  test('finds files matching violation patterns', () => {
    withTempDir((dir) => {
      // Create files
      const cliDir = path.join(dir, 'src', 'cli', 'lib');
      fs.mkdirSync(cliDir, { recursive: true });
      fs.writeFileSync(
        path.join(cliDir, 'rules.ts'),
        "import { generateRule } from '../../lib/rule-generator';\nexport function createRule() {}\n"
      );

      const adapterDir = path.join(dir, 'src', 'adapter');
      fs.mkdirSync(adapterDir, { recursive: true });
      fs.writeFileSync(path.join(adapterDir, 'review.ts'), 'export function reviewAdapter() {}');

      const result = previewRule({
        targetDir: dir,
        globs: ['src/cli/**/*.ts'],
        violationPatterns: ["from '../../lib/"],
      });

      expect(result.flagged.length).toBeGreaterThan(0);
      expect(result.flagged.some((f) => f.filePath.includes('rules.ts'))).toBe(true);
    });
  });

  test('identifies passing files that match globs but have no violations', () => {
    withTempDir((dir) => {
      const cliDir = path.join(dir, 'src', 'cli');
      fs.mkdirSync(cliDir, { recursive: true });

      // File with violation
      fs.writeFileSync(path.join(cliDir, 'bad.ts'), "import { foo } from '../lib/foo';\n");

      // File without violation
      fs.writeFileSync(
        path.join(cliDir, 'good.ts'),
        "import { bar } from '../adapter/bar';\nexport function doStuff() {}\n"
      );

      const result = previewRule({
        targetDir: dir,
        globs: ['src/cli/**/*.ts'],
        violationPatterns: ["from '../lib/"],
      });

      expect(result.passed.some((f) => f.filePath.includes('good.ts'))).toBe(true);
      expect(result.flagged.some((f) => f.filePath.includes('bad.ts'))).toBe(true);
    });
  });

  test('returns match details with line numbers and content', () => {
    withTempDir((dir) => {
      const srcDir = path.join(dir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'file.ts'),
        "line 1\nconsole.log('debug');\nline 3\nconsole.log('more debug');\n"
      );

      const result = previewRule({
        targetDir: dir,
        globs: ['src/**/*.ts'],
        violationPatterns: ['console.log'],
      });

      const flagged = result.flagged.find((f) => f.filePath.includes('file.ts'));
      expect(flagged).toBeDefined();
      expect(flagged!.matches.length).toBe(2);
      expect(flagged!.matches[0]!.line).toBe(2);
      expect(flagged!.matches[0]!.content).toContain('console.log');
      expect(flagged!.matches[1]!.line).toBe(4);
    });
  });

  test('returns counts', () => {
    withTempDir((dir) => {
      const srcDir = path.join(dir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'bad.ts'), "console.log('x');\n");
      fs.writeFileSync(path.join(srcDir, 'good.ts'), "logger.info('x');\n");

      const result = previewRule({
        targetDir: dir,
        globs: ['src/**/*.ts'],
        violationPatterns: ['console.log'],
      });

      expect(result.totalFiles).toBe(2);
      expect(result.flaggedCount).toBe(1);
      expect(result.passedCount).toBe(1);
    });
  });

  test('returns empty results for no matches', () => {
    withTempDir((dir) => {
      const srcDir = path.join(dir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'clean.ts'), 'export const x = 1;\n');

      const result = previewRule({
        targetDir: dir,
        globs: ['src/**/*.ts'],
        violationPatterns: ['NONEXISTENT_PATTERN_xyz123'],
      });

      expect(result.flaggedCount).toBe(0);
      expect(result.passedCount).toBe(1);
    });
  });

  test('respects negative globs (exclusions)', () => {
    withTempDir((dir) => {
      const srcDir = path.join(dir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'app.ts'), "console.log('x');\n");
      fs.writeFileSync(path.join(srcDir, 'app.test.ts'), "console.log('test');\n");

      const result = previewRule({
        targetDir: dir,
        globs: ['src/**/*.ts', '!**/*.test.*'],
        violationPatterns: ['console.log'],
      });

      // test file should be excluded
      expect(result.totalFiles).toBe(1);
      expect(result.flagged.some((f) => f.filePath.includes('app.test.ts'))).toBe(false);
    });
  });

  test('skips ignored directories', () => {
    withTempDir((dir) => {
      const srcDir = path.join(dir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'app.ts'), "console.log('x');\n");

      const nodeModules = path.join(dir, 'node_modules', 'pkg');
      fs.mkdirSync(nodeModules, { recursive: true });
      fs.writeFileSync(path.join(nodeModules, 'index.ts'), "console.log('x');\n");

      const result = previewRule({
        targetDir: dir,
        globs: ['**/*.ts'],
        violationPatterns: ['console.log'],
      });

      expect(result.flagged.every((f) => !f.filePath.includes('node_modules'))).toBe(true);
    });
  });

  test('caps matches per file at 5', () => {
    withTempDir((dir) => {
      const srcDir = path.join(dir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });

      // Create file with many violations
      const lines = Array.from({ length: 20 }, (_, i) => `console.log('line ${i}');`).join('\n');
      fs.writeFileSync(path.join(srcDir, 'noisy.ts'), lines);

      const result = previewRule({
        targetDir: dir,
        globs: ['src/**/*.ts'],
        violationPatterns: ['console.log'],
      });

      const flagged = result.flagged.find((f) => f.filePath.includes('noisy.ts'));
      expect(flagged).toBeDefined();
      expect(flagged!.matches.length).toBeLessThanOrEqual(5);
    });
  });
});
