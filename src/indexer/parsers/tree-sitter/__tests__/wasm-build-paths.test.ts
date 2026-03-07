import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Validates that WASM files exist at the expected paths in node_modules.
 * These are the same files that get installed when a user runs
 * `brew install mesa-dot-dev/tap/code-review` (via npm install).
 * If these tests fail, the release will also fail in CI.
 */

const PKG_DIR = path.resolve(import.meta.dirname, '../../../../..');
const PKG_MODULES = path.join(PKG_DIR, 'node_modules');

const LANGUAGES = ['python', 'go', 'rust', 'java', 'kotlin'] as const;

describe('wasm build paths', () => {
  test('web-tree-sitter runtime wasm exists at workspace path', () => {
    const wasmPath = path.join(PKG_MODULES, 'web-tree-sitter', 'tree-sitter.wasm');
    expect(fs.existsSync(wasmPath)).toBe(true);
  });

  for (const lang of LANGUAGES) {
    test(`tree-sitter-wasms/${lang} grammar exists at workspace path`, () => {
      const wasmPath = path.join(PKG_MODULES, 'tree-sitter-wasms', 'out', `tree-sitter-${lang}.wasm`);
      expect(fs.existsSync(wasmPath)).toBe(true);
    });
  }
});
