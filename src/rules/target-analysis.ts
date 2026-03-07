import fs from 'node:fs';
import path from 'node:path';
import { type CodebaseSnippet, IGNORED_DIRS, PACKAGE_MARKERS } from '../util/constants.js';

interface AnalyzeTargetRequest {
  targetPath: string; // relative to repoRoot (e.g., "src/cli", "packages/web")
  repoRoot: string; // absolute path to repo root
}

interface PlacementOption {
  skillsDir: string; // absolute path where .claude/skills/ would go
  label: string; // human-readable description (e.g., "src/cli (collocated with code)")
  reason: string; // why this option exists
  recommended: boolean; // true for the best default
  type: 'collocated' | 'package' | 'root' | 'existing';
}

export interface TargetAnalysis {
  resolvedPath: string; // absolute path to the target
  relativePath: string; // relative to repo root
  files: CodebaseSnippet[]; // sampled from target dir (up to 5 files, each truncated to 3000 chars)
  boundaryFiles: CodebaseSnippet[]; // sampled from sibling dirs (up to 3 files)
  directoryTree: string; // ascii tree of target's parent showing siblings
  suggestedGlobs: string[]; // e.g., ["src/cli/**/*.ts", "!**/*.test.*", "!**/*.spec.*"]
  detectedLanguages: string[]; // e.g., ["typescript"]
  placements: PlacementOption[];
}

const MAX_TARGET_FILES = 5;
const MAX_BOUNDARY_FILES = 3;
const MAX_FILE_CHARS = 3000;
const MAX_WALK_DEPTH = 8;

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
};

// ---------------------------------------------------------------------------
// Path resolution with fuzzy matching
// ---------------------------------------------------------------------------

/**
 * Resolves a user-provided target path to an actual directory in the repo.
 * If the exact path doesn't exist, searches for directories with matching
 * names and picks the best match, handling typos and partial paths.
 */
export function resolveTargetDirectory(targetPath: string, repoRoot: string): string {
  // Special case: "." always means repo root
  if (targetPath === '.') {
    return repoRoot;
  }

  // Fast path: exact match
  const resolved = path.resolve(repoRoot, targetPath);
  try {
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return resolved;
    if (stat.isFile()) return path.dirname(resolved);
  } catch {
    // Path doesn't exist, try fuzzy matching
  }

  const allDirs = collectAllDirectories(repoRoot, 0);
  const segments = targetPath.split(/[/\\]/).filter(Boolean);
  const targetBasename = segments[segments.length - 1];

  if (!targetBasename) {
    throw new Error(`Could not find directory matching "${targetPath}" in the repository.`);
  }

  // Strategy 1: exact basename match
  const exactMatches = allDirs.filter((d) => path.basename(d) === targetBasename);

  if (exactMatches.length === 1) {
    return exactMatches[0]!;
  }
  if (exactMatches.length > 1) {
    return pickClosestMatch(exactMatches, targetPath, repoRoot);
  }

  // Strategy 2: fuzzy basename match (handles typos like "pacakges" → "packages")
  const maxDist = Math.max(1, Math.floor(targetBasename.length / 3));
  const fuzzyMatches = allDirs
    .map((d) => ({ dir: d, dist: levenshtein(path.basename(d), targetBasename) }))
    .filter((d) => d.dist > 0 && d.dist <= maxDist)
    .sort((a, b) => a.dist - b.dist);

  if (fuzzyMatches.length > 0) {
    const bestDist = fuzzyMatches[0]!.dist;
    const tied = fuzzyMatches.filter((m) => m.dist === bestDist).map((m) => m.dir);
    return pickClosestMatch(tied, targetPath, repoRoot);
  }

  throw new Error(`Could not find directory matching "${targetPath}" in the repository. Check the path and try again.`);
}

function pickClosestMatch(candidates: string[], targetPath: string, repoRoot: string): string {
  if (candidates.length === 1) return candidates[0]!;

  return candidates
    .map((c) => ({ dir: c, dist: levenshtein(path.relative(repoRoot, c), targetPath) }))
    .sort((a, b) => a.dist - b.dist)[0]!.dir;
}

function collectAllDirectories(dir: string, depth: number): string[] {
  if (depth > MAX_WALK_DEPTH) return [];

  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);
    results.push(fullPath);
    results.push(...collectAllDirectories(fullPath, depth + 1));
  }

  return results;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }

  return dp[m]![n]!;
}

// ---------------------------------------------------------------------------
// analyzeTarget
// ---------------------------------------------------------------------------

export function analyzeTarget(request: AnalyzeTargetRequest): TargetAnalysis {
  const { targetPath, repoRoot } = request;

  // Resolve paths — fuzzy-match when the exact path doesn't exist
  const resolvedPath = resolveTargetDirectory(targetPath, repoRoot);
  const relativePath = path.relative(repoRoot, resolvedPath) || '.';

  // Sample files from target directory
  const files = sampleFiles(resolvedPath, repoRoot, MAX_TARGET_FILES);

  // Sample boundary files from siblings
  const boundaryFiles = sampleBoundaryFiles(resolvedPath, repoRoot);

  // Build directory tree
  const directoryTree = buildDirectoryTree(resolvedPath, repoRoot);

  // Detect languages and generate globs
  const detectedLanguages = detectLanguages(files);
  const suggestedGlobs = generateGlobs(relativePath, detectedLanguages);

  // Compute placement options
  const placements = computePlacements(resolvedPath, repoRoot);

  return {
    resolvedPath,
    relativePath,
    files,
    boundaryFiles,
    directoryTree,
    suggestedGlobs,
    detectedLanguages,
    placements,
  };
}

function sampleFiles(dir: string, baseDir: string, maxFiles: number): CodebaseSnippet[] {
  const results: CodebaseSnippet[] = [];
  collectFiles(dir, baseDir, results, maxFiles, 0);
  return results;
}

function collectFiles(dir: string, baseDir: string, results: CodebaseSnippet[], maxFiles: number, depth: number): void {
  if (depth > MAX_WALK_DEPTH || results.length >= maxFiles) {
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort for deterministic output
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (results.length >= maxFiles) {
      return;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      collectFiles(fullPath, baseDir, results, maxFiles, depth + 1);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const relativePath = path.relative(baseDir, fullPath);

    if (content.length > MAX_FILE_CHARS) {
      content = `${content.slice(0, MAX_FILE_CHARS)}\n[truncated at ${MAX_FILE_CHARS} characters]`;
    }

    results.push({ filePath: relativePath, content });
  }
}

function sampleBoundaryFiles(targetPath: string, repoRoot: string): CodebaseSnippet[] {
  // If target is repo root, no boundary files
  if (path.resolve(targetPath) === path.resolve(repoRoot)) {
    return [];
  }

  const parentDir = path.dirname(targetPath);

  let siblings: fs.Dirent[];
  try {
    siblings = fs.readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const targetName = path.basename(targetPath);
  const boundaryFiles: CodebaseSnippet[] = [];

  // Sort for deterministic output
  siblings.sort((a, b) => a.name.localeCompare(b.name));

  for (const sibling of siblings) {
    if (boundaryFiles.length >= MAX_BOUNDARY_FILES) {
      break;
    }

    // Skip the target itself
    if (sibling.name === targetName) {
      continue;
    }

    // Skip ignored dirs
    if (IGNORED_DIRS.has(sibling.name)) {
      continue;
    }

    if (sibling.isDirectory()) {
      const siblingPath = path.join(parentDir, sibling.name);
      const files = sampleFiles(siblingPath, repoRoot, MAX_BOUNDARY_FILES - boundaryFiles.length);
      boundaryFiles.push(...files);
    }
  }

  return boundaryFiles.slice(0, MAX_BOUNDARY_FILES);
}

function buildDirectoryTree(targetPath: string, repoRoot: string): string {
  // If target is repo root, return simple tree
  if (path.resolve(targetPath) === path.resolve(repoRoot)) {
    return '.  ← target';
  }

  const parentDir = path.dirname(targetPath);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return '';
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const lines: string[] = [];
  const parentName = path.basename(parentDir);
  const targetName = path.basename(targetPath);

  lines.push(`${parentName}/`);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const isLast = i === entries.length - 1;
    const prefix = isLast ? '└── ' : '├── ';
    const isTarget = entry.name === targetName;
    const marker = isTarget ? '  ← target' : '';

    if (entry.isDirectory()) {
      lines.push(`${prefix}${entry.name}/${marker}`);

      // Show one level of children for each directory
      if (!IGNORED_DIRS.has(entry.name)) {
        try {
          const childPath = path.join(parentDir, entry.name);
          const children = fs.readdirSync(childPath, { withFileTypes: true });
          const childPrefix = isLast ? '    ' : '│   ';

          children
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 3)
            .forEach((child, idx, arr) => {
              const childIsLast = idx === arr.length - 1;
              const childBranch = childIsLast ? '└── ' : '├── ';
              const childName = child.isDirectory() ? `${child.name}/` : child.name;
              lines.push(`${childPrefix}${childBranch}${childName}`);
            });
        } catch {
          // Ignore read errors
        }
      }
    } else {
      lines.push(`${prefix}${entry.name}${marker}`);
    }
  }

  return lines.join('\n');
}

function detectLanguages(files: CodebaseSnippet[]): string[] {
  const languagesSet = new Set<string>();

  for (const file of files) {
    const ext = path.extname(file.filePath).slice(1); // Remove leading dot
    const language = EXTENSION_TO_LANGUAGE[ext];
    if (language) {
      languagesSet.add(language);
    }
  }

  return Array.from(languagesSet).sort();
}

function generateGlobs(relativePath: string, detectedLanguages: string[]): string[] {
  const globs: string[] = [];

  // Use clean path prefix - when relativePath is ".", use just "**" patterns
  const prefix = relativePath === '.' ? '' : `${relativePath}/`;

  // Reverse map languages to extensions
  const languageToExts: Record<string, string[]> = {
    typescript: ['ts', 'tsx'],
    javascript: ['js', 'jsx'],
    python: ['py'],
    rust: ['rs'],
    go: ['go'],
    java: ['java'],
    ruby: ['rb'],
  };

  const extensions = new Set<string>();
  for (const lang of detectedLanguages) {
    const exts = languageToExts[lang] || [];
    exts.forEach((ext) => extensions.add(ext));
  }

  // If no languages detected, add a generic glob
  if (extensions.size === 0) {
    globs.push(`${prefix}**/*`);
  } else {
    const extList = Array.from(extensions).sort();
    if (extList.length === 1) {
      globs.push(`${prefix}**/*.${extList[0]}`);
    } else {
      globs.push(`${prefix}**/*.{${extList.join(',')}}`);
    }
  }

  // Add exclusions
  globs.push('!**/*.test.*');
  globs.push('!**/*.spec.*');

  return globs;
}

function computePlacements(targetPath: string, repoRoot: string): PlacementOption[] {
  const placements: PlacementOption[] = [];
  const seenPaths = new Set<string>();

  // 1. Collocated placement (always recommended)
  const collocatedSkillsDir = path.join(targetPath, '.claude', 'skills');
  const collocatedExists = fs.existsSync(collocatedSkillsDir);
  const collocatedType = collocatedExists ? 'existing' : 'collocated';

  // Special case: if target is repo root, skip collocated (will be same as root)
  const isRepoRoot = path.resolve(targetPath) === path.resolve(repoRoot);

  if (!isRepoRoot) {
    placements.push({
      skillsDir: collocatedSkillsDir,
      label: `${path.relative(repoRoot, targetPath)} (collocated with code)`,
      reason: 'Keep rule close to the code it reviews',
      recommended: true,
      type: collocatedType,
    });
    seenPaths.add(collocatedSkillsDir);
  }

  // 2. Walk up to find package boundaries
  let current = targetPath;
  while (path.resolve(current) !== path.resolve(repoRoot)) {
    const parent = path.dirname(current);
    if (parent === current) break; // Hit filesystem root (safety valve)

    for (const pkgFile of PACKAGE_MARKERS) {
      const pkgPath = path.join(parent, pkgFile);
      if (fs.existsSync(pkgPath)) {
        const pkgSkillsDir = path.join(parent, '.claude', 'skills');

        // Skip if we've already seen this path
        if (seenPaths.has(pkgSkillsDir)) {
          break;
        }

        const pkgExists = fs.existsSync(pkgSkillsDir);
        const pkgType = pkgExists ? 'existing' : 'package';

        placements.push({
          skillsDir: pkgSkillsDir,
          label: `${path.relative(repoRoot, parent)} (package boundary)`,
          reason: 'Scope rule to this package',
          recommended: false,
          type: pkgType,
        });
        seenPaths.add(pkgSkillsDir);
        break;
      }
    }

    current = parent;
  }

  // 3. Root placement (always present)
  const rootSkillsDir = path.join(repoRoot, '.claude', 'skills');
  if (!seenPaths.has(rootSkillsDir)) {
    const rootExists = fs.existsSync(rootSkillsDir);
    const rootType = rootExists ? 'existing' : 'root';

    placements.push({
      skillsDir: rootSkillsDir,
      label: 'Repo root (global)',
      reason: 'Apply rule across the entire repository',
      recommended: isRepoRoot, // Recommended only if target is root
      type: rootType,
    });
  }

  return placements;
}
