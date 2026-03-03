/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDiffs, listChangedFilesFromGit } from './git.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

describe('getDiffs with HEAD includes working tree', () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-git-test-'));
    git(['init', '-b', 'main'], repoDir);
    git(['config', 'user.email', 'test@test.com'], repoDir);
    git(['config', 'user.name', 'Test'], repoDir);
    // Create initial commit so main ref exists
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'initial');
    git(['add', 'README.md'], repoDir);
    git(['commit', '-m', 'initial'], repoDir);
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  test('returns uncommitted changes when headRef is HEAD', () => {
    fs.writeFileSync(path.join(repoDir, 'file.ts'), 'const x = 1;');
    git(['add', 'file.ts'], repoDir);

    const diffs = getDiffs('main', 'HEAD');
    expect(diffs.size).toBeGreaterThan(0);
    expect(diffs.has('file.ts')).toBe(true);
  });

  test('returns untracked file diffs when headRef is HEAD', () => {
    fs.writeFileSync(path.join(repoDir, 'untracked.ts'), 'export const y = 2;');

    const diffs = getDiffs('main', 'HEAD');
    expect(diffs.has('untracked.ts')).toBe(true);
  });

  test('returns committed branch changes when headRef is not HEAD', () => {
    git(['checkout', '-b', 'feature'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'feature.ts'), 'const f = 1;');
    git(['add', 'feature.ts'], repoDir);
    git(['commit', '-m', 'feature commit'], repoDir);

    const diffs = getDiffs('main', 'feature');
    expect(diffs.has('feature.ts')).toBe(true);
  });

  test('returns empty when no changes exist', () => {
    const diffs = getDiffs('main', 'HEAD');
    expect(diffs.size).toBe(0);
  });

  test('includes both committed and uncommitted on feature branch', () => {
    git(['checkout', '-b', 'feature'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'committed.ts'), 'const c = 1;');
    git(['add', 'committed.ts'], repoDir);
    git(['commit', '-m', 'feature commit'], repoDir);

    // Add uncommitted change
    fs.writeFileSync(path.join(repoDir, 'uncommitted.ts'), 'const u = 1;');
    git(['add', 'uncommitted.ts'], repoDir);

    const diffs = getDiffs('main', 'HEAD');
    expect(diffs.has('committed.ts')).toBe(true);
    expect(diffs.has('uncommitted.ts')).toBe(true);
  });
});

describe('listChangedFilesFromGit with HEAD includes working tree', () => {
  let repoDir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-git-test-'));
    git(['init', '-b', 'main'], repoDir);
    git(['config', 'user.email', 'test@test.com'], repoDir);
    git(['config', 'user.name', 'Test'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'README.md'), 'initial');
    git(['add', 'README.md'], repoDir);
    git(['commit', '-m', 'initial'], repoDir);
    process.chdir(repoDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  test('returns uncommitted files when headRef is HEAD', () => {
    fs.writeFileSync(path.join(repoDir, 'new.ts'), 'const n = 1;');
    git(['add', 'new.ts'], repoDir);

    const files = listChangedFilesFromGit('main', 'HEAD');
    expect(files).toContain('new.ts');
  });

  test('returns untracked files when headRef is HEAD', () => {
    fs.writeFileSync(path.join(repoDir, 'untracked.ts'), 'export const y = 2;');

    const files = listChangedFilesFromGit('main', 'HEAD');
    expect(files).toContain('untracked.ts');
  });

  test('does not include untracked for non-HEAD ref', () => {
    git(['checkout', '-b', 'feature'], repoDir);
    fs.writeFileSync(path.join(repoDir, 'committed.ts'), 'const c = 1;');
    git(['add', 'committed.ts'], repoDir);
    git(['commit', '-m', 'feature commit'], repoDir);

    // Add untracked file that should NOT appear for branch comparison
    fs.writeFileSync(path.join(repoDir, 'untracked.ts'), 'nope');

    const files = listChangedFilesFromGit('main', 'feature');
    expect(files).toContain('committed.ts');
    expect(files).not.toContain('untracked.ts');
  });
});
