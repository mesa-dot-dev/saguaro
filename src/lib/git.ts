import { execFileSync } from 'node:child_process';

const VALID_GIT_REF = /^[a-zA-Z0-9][a-zA-Z0-9/_.\-^~]*$/;

export function listChangedFilesFromGit(baseRef: string, headRef: string): string[] {
  assertInsideGitRepo();
  assertValidGitRef(baseRef, 'base branch');
  assertValidGitRef(headRef, 'head ref');

  const output = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...${headRef}`], {
    encoding: 'utf8',
  });

  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function assertInsideGitRepo(): void {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
  } catch {
    throw new Error('Not a git repository');
  }
}

function assertValidGitRef(ref: string, label: string): void {
  if (!VALID_GIT_REF.test(ref)) {
    throw new Error(`Invalid ${label}`);
  }
}
