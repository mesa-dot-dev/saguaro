import fs from 'node:fs';
import path from 'node:path';
import { ResolverFactory } from 'oxc-resolver';
import type { Language } from './types.js';
import { SKIP_DIRS } from './types.js';

/**
 * Thin abstraction over module resolution.
 * resolve() returns a repo-relative path on success, null for externals/failures.
 */
export interface ModuleResolver {
  resolve(importerPath: string, specifier: string, language?: Language): string | null;
}

/**
 * Specifiers that should never be resolved against the filesystem.
 * node: builtins and URL-scheme imports are always external.
 */
const EXTERNAL_PREFIXES = ['node:', 'http:', 'https:'];

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

  // Cached Go module prefix (undefined = not loaded, null = no go.mod found).
  let goModulePrefix: string | null | undefined;
  function getGoModulePrefix(): string | null {
    if (goModulePrefix !== undefined) return goModulePrefix;
    const goModPath = path.join(rootDir, 'go.mod');
    if (!fs.existsSync(goModPath)) {
      goModulePrefix = null;
      return null;
    }
    const content = fs.readFileSync(goModPath, 'utf-8');
    const match = content.match(/^module\s+(\S+)/m);
    goModulePrefix = match ? match[1] : null;
    return goModulePrefix;
  }

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

  return {
    resolve(importerPath: string, specifier: string, language?: Language): string | null {
      switch (language) {
        case 'python':
          return resolvePython(rootDir, importerPath, specifier);
        case 'go':
          return resolveGo(rootDir, specifier, getGoModulePrefix());
        case 'rust':
          return resolveRust(rootDir, importerPath, specifier);
        case 'java':
          return resolveJvm(rootDir, importerPath, specifier, '.java');
        case 'kotlin':
          return resolveJvm(rootDir, importerPath, specifier, '.kt');
        default:
          return resolveTypeScript(rootDir, importerPath, specifier, tsconfigs, getFactory);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// TS/JS resolution (oxc-resolver)
// ---------------------------------------------------------------------------

function resolveTypeScript(
  rootDir: string,
  importerPath: string,
  specifier: string,
  tsconfigs: string[],
  getFactory: (tsconfigPath: string | null) => ResolverFactory
): string | null {
  if (EXTERNAL_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
    return null;
  }

  try {
    const absImporterPath = path.isAbsolute(importerPath) ? importerPath : path.join(rootDir, importerPath);

    const fileDir = path.dirname(absImporterPath);
    let tsconfigPath: string | null = null;
    for (const tc of tsconfigs) {
      const tcDir = path.dirname(tc);
      if (fileDir === tcDir || fileDir.startsWith(tcDir + path.sep)) {
        tsconfigPath = tc;
        break;
      }
    }

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
}

// ---------------------------------------------------------------------------
// Python convention-based resolution
// ---------------------------------------------------------------------------

function resolvePython(rootDir: string, importerPath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) {
    // Absolute import — try to find as a file/package in the repo
    const parts = specifier.split('.');
    const relPath = parts.join(path.sep);
    const candidates = [`${relPath}.py`, path.join(relPath, '__init__.py')];
    for (const candidate of candidates) {
      const abs = path.join(rootDir, candidate);
      if (fs.existsSync(abs)) return candidate;
    }
    return null; // stdlib or pip package
  }

  // Relative import: count leading dots
  let dots = 0;
  while (dots < specifier.length && specifier[dots] === '.') dots++;
  const rest = specifier.slice(dots);

  const importerDir = path.dirname(path.join(rootDir, importerPath));
  let baseDir = importerDir;
  for (let i = 1; i < dots; i++) {
    baseDir = path.dirname(baseDir);
  }

  const parts = rest ? rest.split('.') : [];
  const relBase = path.join(baseDir, ...parts);

  const candidates = [`${relBase}.py`, path.join(relBase, '__init__.py')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const rel = path.relative(rootDir, candidate);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
      return rel;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Go convention-based resolution
// ---------------------------------------------------------------------------

function resolveGo(rootDir: string, specifier: string, modulePrefix: string | null): string | null {
  if (!modulePrefix) return null;
  if (!specifier.startsWith(modulePrefix)) return null;

  // Strip module prefix to get repo-relative directory
  const relDir = specifier.slice(modulePrefix.length).replace(/^\//, '');
  if (!relDir) return null;

  const absDir = path.join(rootDir, relDir);
  if (!fs.existsSync(absDir)) return null;

  // Return the directory path — Go packages are directory-level
  return relDir;
}

// ---------------------------------------------------------------------------
// Rust convention-based resolution
// ---------------------------------------------------------------------------

function resolveRust(rootDir: string, importerPath: string, specifier: string): string | null {
  const parts = specifier.split('::');

  if (parts[0] === 'crate') {
    // crate::foo::bar → find nearest Cargo.toml, then resolve from its src/ directory
    const crateRoot = findNearestProjectRoot(rootDir, importerPath, 'Cargo.toml');
    const srcDir = path.join(crateRoot, 'src');
    const pathParts = parts.slice(1);
    return resolveRustPath(rootDir, srcDir, pathParts);
  }

  if (parts[0] === 'super') {
    // super::foo → parent module of importer
    // For regular files (helpers.rs), parent module is the containing directory (utils/mod.rs)
    // For mod.rs files, parent module is one directory up
    const importerAbs = path.join(rootDir, importerPath);
    const importerDir = path.dirname(importerAbs);
    const isMod = path.basename(importerPath) === 'mod.rs' || path.basename(importerPath) === 'lib.rs';
    const baseDir = isMod ? path.dirname(importerDir) : importerDir;
    const pathParts = parts.slice(1);
    const relBase = path.relative(rootDir, baseDir);
    return resolveRustPath(rootDir, relBase, pathParts);
  }

  if (parts[0] === 'self') {
    // self::foo → same directory as importer
    const importerDir = path.dirname(path.join(rootDir, importerPath));
    const pathParts = parts.slice(1);
    const relBase = path.relative(rootDir, importerDir);
    return resolveRustPath(rootDir, relBase, pathParts);
  }

  // External crate
  return null;
}

// ---------------------------------------------------------------------------
// JVM (Java + Kotlin) convention-based resolution
// ---------------------------------------------------------------------------

const JVM_STDLIB_PREFIXES = ['java.', 'javax.', 'kotlin.', 'kotlinx.', 'android.'];

const JVM_SOURCE_ROOTS = ['src/main/java', 'src/main/kotlin', 'src', ''];

const JVM_PROJECT_MARKERS = ['build.gradle', 'build.gradle.kts', 'pom.xml'];

function resolveJvm(rootDir: string, importerPath: string, specifier: string, extension: string): string | null {
  // Skip standard library imports
  if (JVM_STDLIB_PREFIXES.some((prefix) => specifier.startsWith(prefix))) {
    return null;
  }

  // Find the nearest project root (build.gradle / pom.xml) relative to the importer
  const projectRoot = findNearestProjectRootMulti(rootDir, importerPath, JVM_PROJECT_MARKERS);

  // Convert dots to path separators: com.example.Foo → com/example/Foo
  const relPath = specifier.split('.').join(path.sep);

  for (const srcRoot of JVM_SOURCE_ROOTS) {
    const candidate = srcRoot
      ? path.join(projectRoot, srcRoot, `${relPath}${extension}`)
      : path.join(projectRoot, `${relPath}${extension}`);
    if (fs.existsSync(path.join(rootDir, candidate))) {
      return candidate;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Project root discovery — walk up from importer to find nearest marker file
// ---------------------------------------------------------------------------

/**
 * Walk up from the importer's directory to find the nearest directory containing
 * the given marker file (e.g. Cargo.toml). Returns the repo-relative path to
 * that directory, or '' (repo root) if no marker is found.
 */
function findNearestProjectRoot(rootDir: string, importerPath: string, marker: string): string {
  const absRoot = path.resolve(rootDir);
  let dir = path.dirname(path.join(absRoot, importerPath));

  while (dir.startsWith(absRoot)) {
    if (fs.existsSync(path.join(dir, marker))) {
      const rel = path.relative(absRoot, dir);
      return rel || '';
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return '';
}

/**
 * Same as findNearestProjectRoot but checks multiple marker files.
 */
function findNearestProjectRootMulti(rootDir: string, importerPath: string, markers: string[]): string {
  const absRoot = path.resolve(rootDir);
  let dir = path.dirname(path.join(absRoot, importerPath));

  while (dir.startsWith(absRoot)) {
    for (const marker of markers) {
      if (fs.existsSync(path.join(dir, marker))) {
        const rel = path.relative(absRoot, dir);
        return rel || '';
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return '';
}

function resolveRustPath(rootDir: string, base: string, pathParts: string[]): string | null {
  if (pathParts.length === 0) {
    // Resolve to mod.rs in the base directory
    const modPath = path.join(base, 'mod.rs');
    if (fs.existsSync(path.join(rootDir, modPath))) return modPath;
    return null;
  }

  const relPath = path.join(base, ...pathParts);
  const candidates = [`${relPath}.rs`, path.join(relPath, 'mod.rs')];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(rootDir, candidate))) {
      if (candidate.startsWith('..') || path.isAbsolute(candidate)) return null;
      return candidate;
    }
  }

  return null;
}
