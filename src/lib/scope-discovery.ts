import fs from 'node:fs';
import path from 'node:path';
import { IGNORED_DIRS, PACKAGE_MARKERS } from './constants.js';

export interface ScopeOption {
  path: string;
  label: string;
  type: 'root' | 'package' | 'existing-skills';
}

const MAX_DEPTH = 5;
const MAX_RESULTS = 15;

/**
 * Discovers valid scope targets (package boundaries and existing `.claude/skills/` dirs)
 * within a repository tree. Results are relative to the repo root.
 */
export function discoverScopeOptions(repoRoot: string): ScopeOption[] {
  const results: ScopeOption[] = [{ path: '.', label: 'Repo root (global)', type: 'root' }];

  walkTree(repoRoot, repoRoot, 0, results);

  return results.slice(0, MAX_RESULTS);
}

function walkTree(dir: string, repoRoot: string, depth: number, results: ScopeOption[]): void {
  if (depth > MAX_DEPTH) {
    return;
  }
  if (results.length >= MAX_RESULTS) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const subdirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !IGNORED_DIRS.has(e.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of subdirs) {
    if (results.length >= MAX_RESULTS) {
      return;
    }

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(repoRoot, fullPath);

    const hasSkillsDir = fs.existsSync(path.join(fullPath, '.claude', 'skills'));
    const hasPackageMarker = PACKAGE_MARKERS.some((marker) => fs.existsSync(path.join(fullPath, marker)));

    if (hasSkillsDir) {
      results.push({
        path: relativePath,
        label: `${relativePath} (has skills)`,
        type: 'existing-skills',
      });
    } else if (hasPackageMarker) {
      results.push({
        path: relativePath,
        label: relativePath,
        type: 'package',
      });
    }

    walkTree(fullPath, repoRoot, depth + 1, results);
  }
}
