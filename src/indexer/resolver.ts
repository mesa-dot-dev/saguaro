import fs from 'node:fs';
import path from 'node:path';
import { ResolverFactory } from 'oxc-resolver';

/**
 * Thin abstraction over module resolution.
 * resolve() returns a repo-relative path on success, null for externals/failures.
 */
export interface ModuleResolver {
  resolve(importerPath: string, specifier: string): string | null;
}

/**
 * Specifiers that should never be resolved against the filesystem.
 * node: builtins and URL-scheme imports are always external.
 */
const EXTERNAL_PREFIXES = ['node:', 'http:', 'https:'];

const SKIP_DIRS = new Set([
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
]);

/**
 * Shared resolver options (everything except tsconfig).
 */
const BASE_OPTIONS = {
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'],
  extensionAlias: {
    '.js': ['.ts', '.js'] as string[],
    '.jsx': ['.tsx', '.jsx'] as string[],
    '.mjs': ['.mts', '.mjs'] as string[],
    '.cjs': ['.cts', '.cjs'] as string[],
  },
  conditionNames: ['node', 'import'],
  mainFields: ['module', 'main'],
  mainFiles: ['index'],
};

/**
 * Find all tsconfig.json files in the repo, skipping irrelevant directories.
 * Returns absolute paths sorted deepest-first so nearest-match lookup
 * can simply iterate and take the first ancestor match.
 */
function discoverTsconfigs(rootDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name === 'tsconfig.json') {
        results.push(path.join(dir, entry.name));
      }
    }
  }

  walk(rootDir);

  // Sort deepest-first so packages/web/tsconfig.json is checked before the root tsconfig.json
  return results.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
}

/**
 * Create a ModuleResolver backed by oxc-resolver for TS/JS module resolution.
 * In monorepos, each sub-package may have its own tsconfig.json with distinct
 * path aliases (e.g., `@/*`). This resolver discovers all tsconfigs at startup
 * and routes each resolve call through the nearest one.
 *
 * @param rootDir - Absolute path to the repository root.
 *                  All returned paths are relative to this directory.
 */
export function createResolver(rootDir: string): ModuleResolver {
  const tsconfigs = discoverTsconfigs(rootDir);

  // Cache a ResolverFactory per tsconfig path. Created lazily on first use.
  const factories = new Map<string, ResolverFactory>();

  // Fallback factory with no tsconfig (for files outside any tsconfig scope).
  let fallbackFactory: ResolverFactory | null = null;

  function getFactory(tsconfigPath: string | null): ResolverFactory {
    if (tsconfigPath === null) {
      if (!fallbackFactory) {
        fallbackFactory = new ResolverFactory(BASE_OPTIONS);
      }
      return fallbackFactory;
    }

    let factory = factories.get(tsconfigPath);
    if (!factory) {
      factory = new ResolverFactory({
        ...BASE_OPTIONS,
        tsconfig: { configFile: tsconfigPath, references: 'auto' },
      });
      factories.set(tsconfigPath, factory);
    }
    return factory;
  }

  /**
   * Find the nearest tsconfig.json for a given file path.
   * tsconfigs are sorted deepest-first, so the first one whose directory
   * is an ancestor of the file wins.
   */
  function findNearestTsconfig(absFilePath: string): string | null {
    const fileDir = path.dirname(absFilePath);
    for (const tc of tsconfigs) {
      const tcDir = path.dirname(tc);
      if (fileDir === tcDir || fileDir.startsWith(tcDir + path.sep)) {
        return tc;
      }
    }
    return null;
  }

  return {
    resolve(importerPath: string, specifier: string): string | null {
      if (EXTERNAL_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
        return null;
      }

      try {
        const absImporterPath = path.isAbsolute(importerPath) ? importerPath : path.join(rootDir, importerPath);

        const tsconfigPath = findNearestTsconfig(absImporterPath);
        const factory = getFactory(tsconfigPath);
        const result = factory.resolveFileSync(absImporterPath, specifier);

        if (!result.path) {
          return null;
        }

        const rel = path.relative(rootDir, result.path);

        // Reject paths outside the repo or inside node_modules
        if (rel.startsWith('..') || path.isAbsolute(rel) || rel.includes('node_modules')) {
          return null;
        }

        return rel;
      } catch {
        return null;
      }
    },
  };
}
