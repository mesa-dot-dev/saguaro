import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GitNotFoundError } from './errors.js';

const VALID_GIT_REF = /^[a-zA-Z0-9][a-zA-Z0-9/_.\-^~]*$/;

export function listChangedFilesFromGit(baseRef: string, headRef: string): string[] {
  requireGitRepo();
  assertValidGitRef(baseRef, 'base branch');
  assertValidGitRef(headRef, 'head ref');

  const diffTarget = headRef === 'HEAD' ? getMergeBase(baseRef) : `${baseRef}...${headRef}`;

  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', diffTarget], {
    encoding: 'utf8',
  });

  const files = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (headRef === 'HEAD') {
    const untracked = listUntrackedFiles();
    return [...new Set([...files, ...untracked])];
  }

  return files;
}

export function listLocalChangedFilesFromGit(): string[] {
  requireGitRepo();

  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD'], {
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function requireGitRepo(): void {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  } catch {
    throw new GitNotFoundError();
  }
}

export function getDiffs(baseRef: string, headRef: string): Map<string, string> {
  requireGitRepo();
  assertValidGitRef(baseRef, 'base branch');
  assertValidGitRef(headRef, 'head ref');

  const diffTarget = headRef === 'HEAD' ? getMergeBase(baseRef) : `${baseRef}...${headRef}`;

  const output = execFileSync('git', ['diff', diffTarget], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  const diffs = parseDiffByFile(output);

  if (headRef === 'HEAD') {
    for (const [file, diff] of getUntrackedDiffs()) {
      diffs.set(file, diff);
    }
  }

  return diffs;
}

export function getLocalDiffs(): Map<string, string> {
  requireGitRepo();

  const output = execFileSync('git', ['diff', 'HEAD'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });

  return parseDiffByFile(output);
}

function parseDiffByFile(rawDiff: string): Map<string, string> {
  const result = new Map<string, string>();
  const parts = rawDiff.split(/^diff --git /m);

  for (const part of parts) {
    if (!part.trim()) continue;

    const headerMatch = part.match(/^a\/\S+ b\/(\S+)/);
    if (!headerMatch) continue;

    const filepath = headerMatch[1];
    result.set(filepath, `diff --git ${part}`);
  }

  return result;
}

export function getRepoRoot(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    throw new GitNotFoundError();
  }
}

export function getFileAtRef(ref: string, filePath: string): string | null {
  assertValidGitRef(ref, 'ref');
  if (filePath.startsWith('/') || filePath.includes('..')) {
    return null;
  }
  try {
    return execFileSync('git', ['show', `${ref}:${filePath}`], {
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024,
    });
  } catch {
    return null;
  }
}

export function listUntrackedFiles(): string[] {
  requireGitRepo();

  const output = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function getUntrackedDiffs(): Map<string, string> {
  const repoRoot = getRepoRoot();
  const untrackedFiles = listUntrackedFiles();
  const result = new Map<string, string>();

  for (const filePath of untrackedFiles) {
    const absolutePath = path.join(repoRoot, filePath);
    try {
      const content = fs.readFileSync(absolutePath, 'utf8');
      const lines = content.split('\n');
      const additions = lines.map((line) => `+${line}`).join('\n');
      const lineCount = lines.length;

      const syntheticDiff = [
        `diff --git a/${filePath} b/${filePath}`,
        'new file mode 100644',
        '--- /dev/null',
        `+++ b/${filePath}`,
        `@@ -0,0 +1,${lineCount} @@`,
        additions,
      ].join('\n');

      result.set(filePath, syntheticDiff);
    } catch {
      // Skip files that can't be read (binary, permission issues, etc.)
    }
  }

  return result;
}

/**
 * Get unified diffs for specific files against HEAD.
 * Accepts an explicit cwd for use from the daemon worker.
 */
export function getDiffsForFiles(files: string[], cwd: string): Map<string, string> {
  if (files.length === 0) return new Map();

  const output = execFileSync('git', ['diff', 'HEAD', '--', ...files], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    cwd,
  });

  const diffs = parseDiffByFile(output);

  // Also check for untracked files (new files not yet staged)
  const untrackedOutput = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...files], {
    encoding: 'utf8',
    cwd,
  });
  const untrackedFiles = untrackedOutput
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const filePath of untrackedFiles) {
    if (!diffs.has(filePath)) {
      const absolutePath = path.join(cwd, filePath);
      try {
        const content = fs.readFileSync(absolutePath, 'utf8');
        const lines = content.split('\n');
        const additions = lines.map((line) => `+${line}`).join('\n');
        diffs.set(
          filePath,
          [
            `diff --git a/${filePath} b/${filePath}`,
            'new file mode 100644',
            '--- /dev/null',
            `+++ b/${filePath}`,
            `@@ -0,0 +1,${lines.length} @@`,
            additions,
          ].join('\n')
        );
      } catch {
        // Skip unreadable files
      }
    }
  }

  return diffs;
}

export function getDefaultBranch(): string {
  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', candidate], { stdio: 'ignore' });
      return candidate;
    } catch {}
  }
  return 'main';
}

function getMergeBase(baseRef: string): string {
  return execFileSync('git', ['merge-base', baseRef, 'HEAD'], { encoding: 'utf8' }).trim();
}

function assertValidGitRef(ref: string, label: string): void {
  if (!VALID_GIT_REF.test(ref)) {
    throw new Error(`Invalid ${label}`);
  }
}
