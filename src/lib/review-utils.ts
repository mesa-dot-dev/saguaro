import type { RulePolicy } from '../types/types.js';

/**
 * Splits files into batches for parallel review workers.
 */
export function splitFilesForWorkers(
  filesWithRules: Map<string, RulePolicy[]>,
  filesPerWorker: number
): Map<string, RulePolicy[]>[] {
  const entries = Array.from(filesWithRules.entries());
  const groups: Map<string, RulePolicy[]>[] = [];
  for (let i = 0; i < entries.length; i += filesPerWorker) {
    groups.push(new Map(entries.slice(i, i + filesPerWorker)));
  }
  return groups;
}

/**
 * Counts the number of unique rules across all files.
 */
export function countRules(filesWithRules: Map<string, RulePolicy[]>): number {
  const uniqueRules = new Set<string>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      uniqueRules.add(rule.id);
    }
  }
  return uniqueRules.size;
}
