import type { StarterRule } from '../templates/starter-rules.js';
import type { RulePolicy } from '../types/types.js';

/**
 * Filter the starter rules catalog to those relevant for the detected ecosystems.
 *
 * @param catalog - Full starter rules catalog
 * @param detectedEcosystems - Set of ecosystem IDs present in the repo
 * @param fileMatchChecker - Function that returns true if any file in the repo matches the given globs
 * @returns Array of RulePolicy objects ready to be written to .saguaro/rules/
 */
export function selectStarterRules(
  catalog: StarterRule[],
  detectedEcosystems: Set<string>,
  fileMatchChecker: (globs: string[]) => boolean
): RulePolicy[] {
  const selected: RulePolicy[] = [];

  for (const rule of catalog) {
    if (rule.ecosystems.length > 0 && !rule.ecosystems.every((e) => detectedEcosystems.has(e))) {
      continue;
    }
    if (rule.requires?.files && !fileMatchChecker(rule.requires.files)) {
      continue;
    }
    const { ecosystems: _, requires: __, ...policy } = rule;
    selected.push(policy);
  }

  return selected;
}
