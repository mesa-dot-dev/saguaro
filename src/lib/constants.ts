import { minimatch } from 'minimatch';

export const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.cache',
  '.vscode',
  '.idea',
  'vendor',
  'coverage',
  '__pycache__',
]);

export const PACKAGE_MARKERS = ['package.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'];

export interface CodebaseSnippet {
  filePath: string;
  content: string;
}

export function toKebabCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Returns true only if filePath matches at least one positive glob and no negation (`!`) globs. */
export function matchesGlobs(filePath: string, globs: string[]): boolean {
  let matched = false;
  let excluded = false;

  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (minimatch(filePath, glob.slice(1))) {
        excluded = true;
      }
      continue;
    }

    if (minimatch(filePath, glob)) {
      matched = true;
    }
  }

  return matched && !excluded;
}
