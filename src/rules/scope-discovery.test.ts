/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverScopeOptions } from './scope-discovery.js';

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saguaro-scope-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('discoverScopeOptions', () => {
  test('always includes repo root as first option', () => {
    withTempRepo((root) => {
      const options = discoverScopeOptions(root);
      expect(options.length).toBeGreaterThanOrEqual(1);
      expect(options[0]).toEqual({
        path: '.',
        label: 'Repo root (global)',
        type: 'root',
      });
    });
  });

  test('discovers package.json boundaries', () => {
    withTempRepo((root) => {
      const pkgDir = path.join(root, 'packages', 'web');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), '{}');

      const options = discoverScopeOptions(root);
      const pkg = options.find((o) => o.path === 'packages/web');
      expect(pkg).toBeDefined();
      expect(pkg!.type).toBe('package');
      expect(pkg!.label).toContain('packages/web');
    });
  });

  test('discovers existing .claude/skills/ directories', () => {
    withTempRepo((root) => {
      const skillsDir = path.join(root, 'apps', 'api', '.claude', 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const options = discoverScopeOptions(root);
      const found = options.find((o) => o.path === 'apps/api');
      expect(found).toBeDefined();
      expect(found!.type).toBe('existing-skills');
    });
  });

  test('deduplicates package + existing skills (shows as existing-skills)', () => {
    withTempRepo((root) => {
      const pkgDir = path.join(root, 'packages', 'core');
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, 'package.json'), '{}');

      const skillsDir = path.join(pkgDir, '.claude', 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      const options = discoverScopeOptions(root);
      const matches = options.filter((o) => o.path === 'packages/core');
      expect(matches.length).toBe(1);
      expect(matches[0]!.type).toBe('existing-skills');
    });
  });

  test('discovers Cargo.toml and go.mod boundaries', () => {
    withTempRepo((root) => {
      const rustDir = path.join(root, 'crates', 'engine');
      fs.mkdirSync(rustDir, { recursive: true });
      fs.writeFileSync(path.join(rustDir, 'Cargo.toml'), '');

      const goDir = path.join(root, 'services', 'gateway');
      fs.mkdirSync(goDir, { recursive: true });
      fs.writeFileSync(path.join(goDir, 'go.mod'), '');

      const options = discoverScopeOptions(root);

      const rustPkg = options.find((o) => o.path === 'crates/engine');
      expect(rustPkg).toBeDefined();
      expect(rustPkg!.type).toBe('package');

      const goPkg = options.find((o) => o.path === 'services/gateway');
      expect(goPkg).toBeDefined();
      expect(goPkg!.type).toBe('package');
    });
  });

  test('skips node_modules, dist, .git, and other ignored directories', () => {
    withTempRepo((root) => {
      // Create package.json files in directories that should be skipped
      for (const ignored of ['node_modules', 'dist', 'build', 'target', '.next', 'vendor', 'coverage']) {
        const dir = path.join(root, ignored, 'nested');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      }

      // Also put one in a legitimate location to confirm it IS found
      const legitDir = path.join(root, 'packages', 'auth');
      fs.mkdirSync(legitDir, { recursive: true });
      fs.writeFileSync(path.join(legitDir, 'package.json'), '{}');

      const options = discoverScopeOptions(root);
      const paths = options.map((o) => o.path);

      expect(paths).not.toContain('node_modules/nested');
      expect(paths).not.toContain('dist/nested');
      expect(paths).not.toContain('build/nested');
      expect(paths).not.toContain('target/nested');
      expect(paths).not.toContain('.next/nested');
      expect(paths).not.toContain('vendor/nested');
      expect(paths).not.toContain('coverage/nested');
      expect(paths).toContain('packages/auth');
    });
  });

  test('caps results at 15', () => {
    withTempRepo((root) => {
      // Create 20 packages to exceed the cap
      for (let i = 0; i < 20; i++) {
        const dir = path.join(root, `pkg-${String(i).padStart(2, '0')}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      }

      const options = discoverScopeOptions(root);
      expect(options.length).toBeLessThanOrEqual(15);
      // Root should still be first
      expect(options[0]!.type).toBe('root');
    });
  });

  test('discovers pyproject.toml boundaries', () => {
    withTempRepo((root) => {
      const pyDir = path.join(root, 'packages', 'ml');
      fs.mkdirSync(pyDir, { recursive: true });
      fs.writeFileSync(path.join(pyDir, 'pyproject.toml'), '');

      const options = discoverScopeOptions(root);
      const pyPkg = options.find((o) => o.path === 'packages/ml');
      expect(pyPkg).toBeDefined();
      expect(pyPkg!.type).toBe('package');
    });
  });
});
