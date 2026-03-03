import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../git/git.js';
import type { RulePolicy } from '../types/types.js';
import { matchesGlobs } from '../util/constants.js';
import type { MesaRulesResult } from './mesa-rules.js';
import { loadMesaRules, loadMesaRulesFromDir } from './mesa-rules.js';


export interface RuleResolutionResult {
  filesWithRules: Map<string, RulePolicy[]>;
  rulesLoaded: number;
}

export function resolveRulesFromMesaDir(changedFiles: string[], repoRoot: string): RuleResolutionResult {
  return resolveRulesFromLoadResult(changedFiles, loadMesaRules(repoRoot));
}

function resolveRulesFromLoadResult(changedFiles: string[], loadResult: MesaRulesResult): RuleResolutionResult {
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
      if (matchesGlobs(file, rule.policy.globs)) {
        matched.push(rule.policy);
      }
    }

    if (matched.length > 0) {
      filesWithRules.set(file, sortRulesByPriority(matched));
    }
  }

  return {
    filesWithRules,
    rulesLoaded: rules.length,
  };
}

export function resolveRulesForFiles(
  changedFiles: string[],
  options?: { explicitRulesDir?: string; startDir?: string }
): RuleResolutionResult {
  // When an explicit rules directory is provided (e.g. --rules flag, evals),
  // load .md rule files from that directory.
  if (options?.explicitRulesDir) {
    const resolved = path.resolve(options.explicitRulesDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Rules directory not found: ${options.explicitRulesDir}`);
    }
    return resolveRulesFromLoadResult(changedFiles, loadMesaRulesFromDir(resolved));
  }

  const startDir = options?.startDir ?? process.cwd();
  const repoRoot = findRepoRoot(startDir);
  return resolveRulesFromMesaDir(changedFiles, repoRoot);
}

/**
 * Sort rules by descending priority, then alphabetically by id.
 */
export function sortRulesByPriority<T extends Pick<RulePolicy, 'id' | 'priority'>>(rules: T[]): T[] {
  return rules.slice().sort((a, b) => {
    const priorityA = a.priority ?? 0;
    const priorityB = b.priority ?? 0;
    if (priorityA !== priorityB) return priorityB - priorityA;
    return a.id.localeCompare(b.id);
  });
}

export { matchesGlobs } from '../util/constants.js';
