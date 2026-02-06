import { execSync } from 'child_process';
import fs from 'fs';

const getChangedFiles = (baseBranch: string): string[] => {
  try {
    // Check if we are in a git repo
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
  } catch (e) {
    throw new Error('Not a git repository');
  }

  try {
    // Get list of changed files between base and current working tree
    // --name-only: only file names
    // --diff-filter=ACMR: Added, Copied, Modified, Renamed (ignore Deleted)
    // We use the base branch directly to compare working tree against it
    const cmd = `git diff --name-only --diff-filter=ACMR ${baseBranch}...HEAD`;
    const output = execSync(cmd, { encoding: 'utf8' });

    // Filter out empty lines and trim
    return output.split('\n').filter((line: string) => line.trim().length > 0);
  } catch (e: any) {
    throw new Error(`Failed to get changed files: ${e.message}`);
  }
};

const getFileContent = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return null;
  }
};

export { getChangedFiles, getFileContent };
