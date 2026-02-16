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
