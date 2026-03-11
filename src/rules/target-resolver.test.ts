/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTargetInput } from './target-resolver.js';

function withTempRepo(setup: (root: string) => void, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saguaro-resolver-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    setup(root);
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function setupMonorepo(root: string): void {
  // packages/code-review/src/cli/lib/
  fs.mkdirSync(path.join(root, 'packages', 'code-review', 'src', 'cli', 'lib'), { recursive: true });
  // packages/code-review/src/lib/
  fs.mkdirSync(path.join(root, 'packages', 'code-review', 'src', 'lib'), { recursive: true });
  // packages/code-review/src/adapter/
  fs.mkdirSync(path.join(root, 'packages', 'code-review', 'src', 'adapter'), { recursive: true });
  // packages/code-review/evals/
  fs.mkdirSync(path.join(root, 'packages', 'code-review', 'evals'), { recursive: true });
  // packages/web/src/routes/auth/
  fs.mkdirSync(path.join(root, 'packages', 'web', 'src', 'routes', 'auth'), { recursive: true });
  // packages/web/src/components/
  fs.mkdirSync(path.join(root, 'packages', 'web', 'src', 'components'), { recursive: true });
  // packages/core/src/routes/v1/
  fs.mkdirSync(path.join(root, 'packages', 'core', 'src', 'routes', 'v1'), { recursive: true });
  // packages/sdk/
  fs.mkdirSync(path.join(root, 'packages', 'sdk'), { recursive: true });
  // node_modules (should be ignored)
  fs.mkdirSync(path.join(root, 'node_modules', 'some-pkg'), { recursive: true });
  // dist (should be ignored)
  fs.mkdirSync(path.join(root, 'packages', 'code-review', 'dist', 'cli'), { recursive: true });
}

describe('resolveTargetInput', () => {
  // --- browse ---
  test('blank input returns browse', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('', root);
      expect(result.type).toBe('browse');
    });
  });

  test('"?" returns browse', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('?', root);
      expect(result.type).toBe('browse');
    });
  });

  // --- global ---
  test('"global" resolves to repo root', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('global', root);
      expect(result).toEqual({ type: 'exact', path: '.' });
    });
  });

  test('"." resolves to repo root', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('.', root);
      expect(result).toEqual({ type: 'exact', path: '.' });
    });
  });

  // --- exact path ---
  test('exact existing directory path resolves directly', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('packages/code-review/src/cli', root);
      expect(result).toEqual({ type: 'exact', path: 'packages/code-review/src/cli' });
    });
  });

  test('exact path with trailing slash resolves', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('packages/web/', root);
      expect(result).toEqual({ type: 'exact', path: 'packages/web' });
    });
  });

  // --- keyword search ---
  test('keyword "cli" finds cli directories', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('cli', root);
      expect(result.type).toBe('search');
      if (result.type !== 'search') throw new Error('expected search');
      expect(result.matches.length).toBeGreaterThan(0);
      expect(result.matches[0]).toBe('packages/code-review/src/cli');
    });
  });

  test('keyword "auth" finds auth directory', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('auth', root);
      expect(result.type).toBe('search');
      if (result.type !== 'search') throw new Error('expected search');
      expect(result.matches.some((m) => m.includes('auth'))).toBe(true);
    });
  });

  test('keyword "routes" finds routes in multiple packages', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('routes', root);
      expect(result.type).toBe('search');
      if (result.type !== 'search') throw new Error('expected search');
      // Should find routes in both web and core
      expect(result.matches.some((m) => m.includes('web'))).toBe(true);
      expect(result.matches.some((m) => m.includes('core'))).toBe(true);
    });
  });

  test('exact basename matches rank before path-contains matches', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('cli', root);
      expect(result.type).toBe('search');
      if (result.type !== 'search') throw new Error('expected search');
      // "packages/code-review/src/cli" (exact basename "cli") should be before
      // "packages/code-review/src/cli/lib" (path contains "cli" but basename is "lib")
      const cliIdx = result.matches.indexOf('packages/code-review/src/cli');
      const cliLibIdx = result.matches.indexOf('packages/code-review/src/cli/lib');
      expect(cliIdx).toBeLessThan(cliLibIdx);
    });
  });

  test('search is case-insensitive', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('CLI', root);
      expect(result.type).toBe('search');
      if (result.type !== 'search') throw new Error('expected search');
      expect(result.matches.length).toBeGreaterThan(0);
    });
  });

  test('no matches returns empty search result', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('xyznonexistent', root);
      expect(result.type).toBe('search');
      if (result.type !== 'search') throw new Error('expected search');
      expect(result.matches).toEqual([]);
    });
  });

  test('ignores node_modules and dist directories', () => {
    withTempRepo(setupMonorepo, (root) => {
      const result = resolveTargetInput('some-pkg', root);
      expect(result.type).toBe('search');
      if (result.type !== 'search') throw new Error('expected search');
      expect(result.matches).toEqual([]);
    });
  });

  test('caps results at 10', () => {
    withTempRepo(
      (root) => {
        // Create 15 directories named "mod-XX"
        for (let i = 0; i < 15; i++) {
          fs.mkdirSync(path.join(root, `mod-${String(i).padStart(2, '0')}`), { recursive: true });
        }
      },
      (root) => {
        const result = resolveTargetInput('mod', root);
        expect(result.type).toBe('search');
        if (result.type !== 'search') throw new Error('expected search');
        expect(result.matches.length).toBeLessThanOrEqual(10);
      }
    );
  });
});
