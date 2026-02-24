import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Validates that WASM files exist at the canonical workspace paths used by
 * the build scripts (build-binary.sh, release-code-review.yml).
 *
 * These paths are deterministic — they resolve through bun's workspace
 * symlinks in packages/code-review/node_modules/. If these tests fail,
 * the release build will also fail in CI.
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
