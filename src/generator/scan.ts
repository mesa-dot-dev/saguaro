import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManifestInfo {
  languages: string[];
  frameworks: string[];
  dependencies: string[];
  testRunner?: string;
  hasLinter: boolean;
}

export interface FileSample {
  path: string;
  content: string;
}

export interface ScanContext {
  manifest: ManifestInfo;
  fileTree: string[];
  samples: FileSample[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IGNORE_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.git',
  '.mesa',
  'vendor',
  'target',
  '__pycache__',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.cache',
  '.turbo',
  'coverage',
  'venv',
  '.venv',
]);

const IGNORE_FILES = new Set([
  'package-lock.json',
  'yarn.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'go.sum',
  'poetry.lock',
  'Pipfile.lock',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.rb',
  '.swift',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
]);

const FRAMEWORK_MAP: Record<string, string> = {
  react: 'React',
  'react-dom': 'React',
  next: 'Next.js',
  nuxt: 'Nuxt',
  vue: 'Vue',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  express: 'Express',
  fastify: 'Fastify',
  hono: 'Hono',
  koa: 'Koa',
  '@nestjs/core': 'NestJS',
  'drizzle-orm': 'Drizzle ORM',
  prisma: 'Prisma',
  '@prisma/client': 'Prisma',
  typeorm: 'TypeORM',
  sequelize: 'Sequelize',
  mongoose: 'Mongoose',
  zod: 'Zod',
  trpc: 'tRPC',
  '@trpc/server': 'tRPC',
  '@tanstack/react-router': 'TanStack Router',
  '@tanstack/react-query': 'TanStack Query',
  tailwindcss: 'Tailwind CSS',
  '@tailwindcss/vite': 'Tailwind CSS',
};

const TEST_RUNNERS: Record<string, string> = {
  vitest: 'Vitest',
  jest: 'Jest',
  mocha: 'Mocha',
  '@playwright/test': 'Playwright',
  cypress: 'Cypress',
};

const LINTER_CONFIGS = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  'eslint.config.js',
  'eslint.config.mjs',
  'biome.json',
  'biome.jsonc',
];

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.rb': 'Ruby',
  '.swift': 'Swift',
  '.cs': 'C#',
  '.php': 'PHP',
};

const MAX_SAMPLE_LINES = 40;
const MAX_SAMPLES = 5;
const MAX_FILE_TREE = 100;

// ---------------------------------------------------------------------------
// File discovery (shared by sampling + file tree)
// ---------------------------------------------------------------------------

function collectSourceFiles(repoRoot: string): string[] {
  const files: string[] = [];

  const walk = (dir: string, relativePath: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (IGNORE_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) && !IGNORE_FILES.has(entry.name)) {
        files.push(relPath);
      }
    }
  };

  walk(repoRoot, '');
  return files;
}

// ---------------------------------------------------------------------------
// Manifest parsing (package.json focus, file-extension fallback)
// ---------------------------------------------------------------------------

export function parseManifests(repoRoot: string, sourceFiles: string[]): ManifestInfo {
  const languages = new Set<string>();
  const frameworks = new Set<string>();
  const dependencies: string[] = [];
  let testRunner: string | undefined;
  let hasLinter = false;

  const pkgPath = path.join(repoRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps.typescript || fs.existsSync(path.join(repoRoot, 'tsconfig.json'))) {
        languages.add('TypeScript');
      } else {
        languages.add('JavaScript');
      }

      for (const [dep, framework] of Object.entries(FRAMEWORK_MAP)) {
        if (dep in allDeps) frameworks.add(framework);
      }

      for (const [dep, runner] of Object.entries(TEST_RUNNERS)) {
        if (dep in allDeps) {
          testRunner = runner;
          break;
        }
      }

      if (allDeps.eslint || allDeps['@eslint/js'] || allDeps.biome || allDeps['@biomejs/biome']) {
        hasLinter = true;
      }

      dependencies.push(...Object.keys(allDeps));
    } catch {
      // Malformed package.json — fall through to extension-based detection
    }
  }

  // Linter config files on disk
  if (!hasLinter) {
    for (const config of LINTER_CONFIGS) {
      if (fs.existsSync(path.join(repoRoot, config))) {
        hasLinter = true;
        break;
      }
    }
  }

  // Fallback: detect languages from file extensions when no manifest found
  if (languages.size === 0) {
    const extCounts: Record<string, number> = {};
    for (const file of sourceFiles) {
      const ext = path.extname(file);
      if (ext) extCounts[ext] = (extCounts[ext] ?? 0) + 1;
    }
    for (const [ext, count] of Object.entries(extCounts)) {
      if (count >= 2 && LANG_BY_EXT[ext]) languages.add(LANG_BY_EXT[ext]);
    }
  }

  return {
    languages: [...languages],
    frameworks: [...frameworks],
    dependencies,
    testRunner,
    hasLinter,
  };
}

// ---------------------------------------------------------------------------
// File sampling (3-5 representative files, 15 lines each)
// ---------------------------------------------------------------------------

function sampleFiles(repoRoot: string, sourceFiles: string[]): FileSample[] {
  const samples: FileSample[] = [];
  const selected = new Set<string>();

  const add = (filePath: string) => {
    if (selected.has(filePath) || samples.length >= MAX_SAMPLES) return;
    selected.add(filePath);
    try {
      const content = fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
      samples.push({ path: filePath, content: content.split('\n').slice(0, MAX_SAMPLE_LINES).join('\n') });
    } catch {
      // Skip unreadable files
    }
  };

  // 1. Entry point
  const entryPattern = /^(src\/)?(?:index|main|app|server)\.(ts|tsx|js|jsx)$/;
  for (const f of sourceFiles) {
    if (entryPattern.test(f)) {
      add(f);
      break;
    }
  }

  // 2. Route / API handler
  const routePattern = /\/(routes|api|handlers|controllers)\//;
  for (const f of sourceFiles) {
    if (routePattern.test(f)) {
      add(f);
      break;
    }
  }

  // 3. Database / schema layer
  const dbPattern = /\/(db|schema|models)\//;
  for (const f of sourceFiles) {
    if (dbPattern.test(f)) {
      add(f);
      break;
    }
  }

  // 4. Test file
  for (const f of sourceFiles) {
    if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(f)) {
      add(f);
      break;
    }
  }

  // 5. Breadth — one file from a directory not yet represented
  const representedDirs = new Set(samples.map((s) => path.dirname(s.path)));
  for (const f of sourceFiles) {
    if (samples.length >= MAX_SAMPLES) break;
    const dir = path.dirname(f);
    if (!representedDirs.has(dir)) {
      add(f);
      representedDirs.add(dir);
    }
  }

  return samples;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export function buildScanContext(repoRoot: string): ScanContext {
  const sourceFiles = collectSourceFiles(repoRoot);
  const manifest = parseManifests(repoRoot, sourceFiles);
  const fileTree = sourceFiles.slice(0, MAX_FILE_TREE);
  const samples = sampleFiles(repoRoot, sourceFiles);

  return { manifest, fileTree, samples };
}

// ---------------------------------------------------------------------------
// Serializer (builds the LLM prompt section)
// ---------------------------------------------------------------------------

export function serializeScanContext(context: ScanContext): string {
  const parts: string[] = [];

  parts.push('## Project Manifest');
  parts.push(`Languages: ${context.manifest.languages.join(', ') || 'Unknown'}`);
  if (context.manifest.frameworks.length > 0) {
    parts.push(`Frameworks: ${context.manifest.frameworks.join(', ')}`);
  }
  if (context.manifest.testRunner) {
    parts.push(`Test Runner: ${context.manifest.testRunner}`);
  }
  parts.push(`Linter configured: ${context.manifest.hasLinter ? 'Yes' : 'No'}`);
  if (context.manifest.dependencies.length > 0) {
    parts.push(`Key dependencies: ${context.manifest.dependencies.slice(0, 30).join(', ')}`);
  }
  parts.push('');

  parts.push('## File Structure');
  parts.push('```');
  for (const file of context.fileTree) {
    parts.push(file);
  }
  parts.push('```');
  parts.push('');

  if (context.samples.length > 0) {
    parts.push('## Code Samples');
    for (const sample of context.samples) {
      parts.push(`### ${sample.path}`);
      parts.push('```');
      parts.push(sample.content);
      parts.push('```');
      parts.push('');
    }
  }

  return parts.join('\n');
}
