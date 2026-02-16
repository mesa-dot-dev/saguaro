import fs from 'node:fs';
import path from 'node:path';
import { type CodebaseSnippet, IGNORED_DIRS, PACKAGE_MARKERS } from './constants.js';

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
  suggestedGlobs: string[]; // e.g., ["packages/code-review/src/cli/**/*.ts", "!**/*.test.*", "!**/*.spec.*"]
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

export function analyzeTarget(request: AnalyzeTargetRequest): TargetAnalysis {
  const { targetPath, repoRoot } = request;

  // Resolve paths
  const resolvedPath = path.resolve(repoRoot, targetPath);
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
