import fs from 'node:fs';
import path from 'node:path';
import { IGNORED_DIRS } from '../util/constants.js';

export type TargetResolution =
  | { type: 'exact'; path: string }
  | { type: 'search'; matches: string[] }
  | { type: 'browse' };

const MAX_SEARCH_DEPTH = 8;
const MAX_SEARCH_RESULTS = 10;

/**
 * Interprets user input for the rule-creation target picker.
 *
 * - blank / "?" → browse (show package menu)
 * - "global" / "." → exact repo root
 * - existing directory path → exact
 * - anything else → substring search across repo directories, ranked
 */
export function resolveTargetInput(input: string, repoRoot: string): TargetResolution {
  const trimmed = input.trim();

  // Browse
  if (trimmed === '' || trimmed === '?') {
    return { type: 'browse' };
  }

  // Global
  if (trimmed === 'global' || trimmed === '.') {
    return { type: 'exact', path: '.' };
  }

  // Normalize: strip trailing slash
  const normalized = trimmed.replace(/\/+$/, '');

  // Exact path check
  const resolved = path.resolve(repoRoot, normalized);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return { type: 'exact', path: normalized };
  }

  // Keyword search
  const allDirs: string[] = [];
  collectDirectories(repoRoot, repoRoot, 0, allDirs);

  const keyword = normalized.toLowerCase();
  const matches = allDirs.filter((d) => d.toLowerCase().includes(keyword));

  // Rank: exact basename match > basename contains > path contains
  // Within each tier, sort by depth (shallowest first)
  const ranked = matches.sort((a, b) => {
    const aBase = path.basename(a).toLowerCase();
    const bBase = path.basename(b).toLowerCase();
    const aExact = aBase === keyword;
    const bExact = bBase === keyword;
    const aContains = aBase.includes(keyword);
    const bContains = bBase.includes(keyword);

    // Tier comparison
    const aTier = aExact ? 0 : aContains ? 1 : 2;
    const bTier = bExact ? 0 : bContains ? 1 : 2;
    if (aTier !== bTier) return aTier - bTier;

    // Same tier: sort by depth (fewer segments = shallower)
    const aDepth = a.split('/').length;
    const bDepth = b.split('/').length;
    return aDepth - bDepth;
  });

  return { type: 'search', matches: ranked.slice(0, MAX_SEARCH_RESULTS) };
}

function collectDirectories(dir: string, repoRoot: string, depth: number, results: string[]): void {
  if (depth > MAX_SEARCH_DEPTH) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(repoRoot, fullPath);
    results.push(relativePath);

    collectDirectories(fullPath, repoRoot, depth + 1, results);
  }
}
