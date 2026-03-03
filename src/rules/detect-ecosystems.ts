import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { ECOSYSTEM_REGISTRY } from '../templates/ecosystems.js';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '__pycache__',
  'venv',
  '.venv',
  'target',
  'vendor',
  '.mesa',
  '.cache',
]);
const MAX_WALK_DEPTH = 5;
export function readPackageDeps(repoRoot: string): Set<string> {
  const pkgPath = path.join(repoRoot, 'package.json');
  const deps = new Set<string>();

  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, 'utf-8');
  } catch {
    return deps;
  }

  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return deps;
  }

  for (const field of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
    const section = pkg[field];
    if (section && typeof section === 'object' && !Array.isArray(section)) {
      for (const name of Object.keys(section as Record<string, unknown>)) {
        deps.add(name);
      }
    }
  }

  return deps;
}
export function readPythonDeps(repoRoot: string): Set<string> {
  const deps = new Set<string>();
  const reqPath = path.join(repoRoot, 'requirements.txt');
  try {
    const raw = fs.readFileSync(reqPath, 'utf-8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
      const name = trimmed.split(/[>=<!~@;[]/)[0]?.trim();
      if (name) deps.add(name);
    }
  } catch {}
  const tomlPath = path.join(repoRoot, 'pyproject.toml');
  try {
    const raw = fs.readFileSync(tomlPath, 'utf-8');
    // Match quoted strings in dependency arrays: "django>=4.0" or 'fastapi'
    const matches = raw.matchAll(/["']([a-zA-Z0-9_-]+)(?:[>=<!~[;].*?)?["']/g);
    for (const m of matches) {
      if (m[1]) deps.add(m[1]);
    }
  } catch {}

  return deps;
}
export function anyFileMatchesGlob(repoRoot: string, globs: string[]): boolean {
  return walkAndMatch(repoRoot, repoRoot, globs, 0);
}

function walkAndMatch(dir: string, repoRoot: string, globs: string[], depth: number): boolean {
  if (depth > MAX_WALK_DEPTH) return false;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const name = entry.name;

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue;
      if (walkAndMatch(path.join(dir, name), repoRoot, globs, depth + 1)) {
        return true;
      }
      continue;
    }

    const relPath = path.relative(repoRoot, path.join(dir, name));
    for (const glob of globs) {
      if (minimatch(relPath, glob)) {
        return true;
      }
    }
  }

  return false;
}

export function detectEcosystems(repoRoot: string): Set<string> {
  const jsDeps = readPackageDeps(repoRoot);
  const pyDeps = readPythonDeps(repoRoot);
  const allDeps = new Set([...jsDeps, ...pyDeps]);

  const detected = new Set<string>();

  for (const eco of ECOSYSTEM_REGISTRY) {
    if (eco.deps) {
      const hasDep = eco.deps.some((d) => allDeps.has(d));
      if (hasDep) {
        detected.add(eco.id);
        continue;
      }
    }

    if (eco.files) {
      if (anyFileMatchesGlob(repoRoot, eco.files)) {
        detected.add(eco.id);
      }
    }
  }

  return detected;
}
