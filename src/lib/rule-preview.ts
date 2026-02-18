import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import { IGNORED_DIRS } from './constants.js';

interface PreviewMatch {
  line: number;
  content: string;
}

interface PreviewFlaggedFile {
  filePath: string;
  matches: PreviewMatch[];
}

interface PreviewPassedFile {
  filePath: string;
}

interface PreviewRuleRequest {
  targetDir: string; // absolute path to scan from
  globs: string[]; // which files to check (positive and negative globs)
  violationPatterns: string[]; // string patterns to search for (from examples.violations)
}

export interface PreviewRuleResult {
  flagged: PreviewFlaggedFile[];
  passed: PreviewPassedFile[];
  totalFiles: number;
  flaggedCount: number;
  passedCount: number;
}

const MAX_FILES = 1000;
const MAX_MATCHES_PER_FILE = 5;

function walkDir(dir: string, files: string[] = []): string[] {
  if (files.length >= MAX_FILES) {
    return files;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (files.length >= MAX_FILES) {
      break;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        walkDir(fullPath, files);
      }
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function matchesGlobs(relativePath: string, globs: string[]): boolean {
  // Split globs into positive and negative
  const positiveGlobs = globs.filter((g) => !g.startsWith('!'));
  const negativeGlobs = globs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));

  // Must match at least one positive glob
  const matchesPositive = positiveGlobs.length === 0 || positiveGlobs.some((g) => minimatch(relativePath, g));

  if (!matchesPositive) {
    return false;
  }

  // Must not match any negative glob
  const matchesNegative = negativeGlobs.some((g) => minimatch(relativePath, g));

  return !matchesNegative;
}

function findViolations(filePath: string, patterns: string[]): PreviewMatch[] {
  const matches: PreviewMatch[] = [];

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (matches.length >= MAX_MATCHES_PER_FILE) {
        break;
      }

      const line = lines[i];

      for (const pattern of patterns) {
        if (line.includes(pattern)) {
          matches.push({
            line: i + 1,
            content: line,
          });
          break; // Only record one match per line
        }
      }
    }
  } catch {
    // Skip files that can't be read as text
  }

  return matches;
}

export function previewRule(request: PreviewRuleRequest): PreviewRuleResult {
  const { targetDir, globs, violationPatterns } = request;

  // Walk directory and collect all files
  const allFiles = walkDir(targetDir);

  const flagged: PreviewFlaggedFile[] = [];
  const passed: PreviewPassedFile[] = [];

  for (const filePath of allFiles) {
    const relativePath = path.relative(targetDir, filePath);

    // Check if file matches globs
    if (!matchesGlobs(relativePath, globs)) {
      continue;
    }

    // Check for violations
    const matches = findViolations(filePath, violationPatterns);

    if (matches.length > 0) {
      flagged.push({
        filePath,
        matches,
      });
    } else {
      passed.push({
        filePath,
      });
    }
  }

  // Sort results deterministically
  flagged.sort((a, b) => a.filePath.localeCompare(b.filePath));
  passed.sort((a, b) => a.filePath.localeCompare(b.filePath));

  return {
    flagged,
    passed,
    totalFiles: flagged.length + passed.length,
    flaggedCount: flagged.length,
    passedCount: passed.length,
  };
}
