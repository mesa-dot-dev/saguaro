import fs from 'node:fs';
import path from 'node:path';
import { minimatch } from 'minimatch';
import type { RulePolicy } from '../types/types.js';
import { loadMesaRules, loadMesaRulesFromDir, loadRulesFromSkillDir } from './mesa-rules.js';

export interface SkillsResolutionResult {
  filesWithRules: Map<string, RulePolicy[]>;
  rulesLoaded: number;
  discoveredSkillDirs: string[];
}

export function findRepoRoot(startDir = process.cwd()): string {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    if (fs.existsSync(path.join(currentDir, '.git'))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return path.resolve(startDir);
}

export function resolveRulesFromMesaDir(changedFiles: string[], repoRoot: string): SkillsResolutionResult {
  return resolveRulesFromLoadResult(changedFiles, loadMesaRules(repoRoot));
}

function resolveRulesFromLoadResult(
  changedFiles: string[],
  loadResult: import('./mesa-rules.js').MesaRulesResult
): SkillsResolutionResult {
  const { rules, errors } = loadResult;

  // Log parse errors but continue with valid rules — one bad file should not
  // break all rules (design doc: "one parse error breaks one rule, not all").
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`Warning: failed to parse ${e.filePath}: ${e.message}`);
    }
  }

  const filesWithRules = new Map<string, RulePolicy[]>();

  for (const file of changedFiles) {
    const matched: RulePolicy[] = [];

    for (const rule of rules) {
      if (matchesSkillGlobs(file, rule.policy.globs)) {
        matched.push(rule.policy);
      }
    }

    if (matched.length > 0) {
      matched.sort((a, b) => {
        const priorityA = a.priority ?? 0;
        const priorityB = b.priority ?? 0;
        if (priorityA !== priorityB) {
          return priorityB - priorityA;
        }
        return a.id.localeCompare(b.id);
      });
      filesWithRules.set(file, matched);
    }
  }

  return {
    filesWithRules,
    rulesLoaded: rules.length,
    discoveredSkillDirs: [],
  };
}

export function resolveSkillsForFiles(
  changedFiles: string[],
  options?: { explicitRulesDir?: string; startDir?: string }
): SkillsResolutionResult {
  // When an explicit rules directory is provided (e.g. --rules flag, evals),
  // auto-detect the format: .md files → mesa-rules, subdirs → legacy skill-dir.
  if (options?.explicitRulesDir) {
    const resolved = path.resolve(options.explicitRulesDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Rules directory not found: ${options.explicitRulesDir}`);
    }
    const hasMdFiles = fs.readdirSync(resolved).some((f) => f.endsWith('.md'));
    const loader = hasMdFiles ? loadMesaRulesFromDir : loadRulesFromSkillDir;
    return resolveRulesFromLoadResult(changedFiles, loader(resolved));
  }

  const startDir = options?.startDir ?? process.cwd();
  const repoRoot = findRepoRoot(startDir);
  return resolveRulesFromMesaDir(changedFiles, repoRoot);
}

function matchesSkillGlobs(filePath: string, globs: string[]): boolean {
  let matched = false;
  let excluded = false;

  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (minimatch(filePath, glob.slice(1))) {
        excluded = true;
      }
      continue;
    }

    if (minimatch(filePath, glob)) {
      matched = true;
    }
  }

  return matched && !excluded;
}
