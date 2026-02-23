/** Directories to skip during file discovery and tsconfig scanning (differs from lib/constants.ts IGNORED_DIRS by including .mesa, .venv, venv). */
export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.mesa',
  '.next',
  '.nuxt',
  '.output',
  'coverage',
  '__pycache__',
  '.turbo',
  '.cache',
  'vendor',
  '.venv',
  'venv',
  'target',
]);
