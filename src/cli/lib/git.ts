import { execSync } from 'node:child_process';
import fs from 'node:fs';

const isValidGitRef = (ref: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9/_.\-^~]*$/.test(ref);

const getChangedFiles = (baseBranch: string | undefined, headRef: string | undefined): string[] => {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch (e) {
    console.error(`Error checking if in git repository: ${e instanceof Error ? e.message : String(e as Error)}`);
    throw new Error('Not a git repository');
  }

  try {
    const baseRef = baseBranch ?? 'main';
    const head = headRef ?? 'HEAD';
    if (!isValidGitRef(baseRef)) {
      throw new Error('Invalid branch name');
    }
    if (!isValidGitRef(head)) {
      throw new Error('Invalid head ref');
    }
    const cmd = `git diff --name-only --diff-filter=ACMR ${baseRef}...${head}`;
    const output = execSync(cmd, { encoding: 'utf8' });

    return output.split('\n').filter((line: string) => line.trim().length > 0);
  } catch (e: unknown) {
    throw new Error(`Failed to get changed files: ${e instanceof Error ? e.message : String(e as Error)}`);
  }
};

const getFileContent = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`Error getting file content for ${filePath}: ${e instanceof Error ? e.message : String(e as Error)}`);
    return null;
  }
};

export { getChangedFiles, getFileContent };
