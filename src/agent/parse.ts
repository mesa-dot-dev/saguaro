import type { Rule, Violation } from '../types/types.js';

export interface ParseViolationsResult {
  violations: Violation[];
  totalLines: number;
  matchedLines: number;
  ignoredLines: number;
  shortCircuitedNoViolations: boolean;
}

export function parseViolations(text: string, filesWithRules: Map<string, Rule[]>): Violation[] {
  return parseViolationsDetailed(text, filesWithRules).violations;
}

export function parseViolationsDetailed(text: string, filesWithRules: Map<string, Rule[]>): ParseViolationsResult {
  const violations: Violation[] = [];
  if (!text) {
    return {
      violations,
      totalLines: 0,
      matchedLines: 0,
      ignoredLines: 0,
      shortCircuitedNoViolations: false,
    };
  }

  if (text.toLowerCase().includes('no violations found')) {
    const totalLines = text.split('\n').length;
    return {
      violations,
      totalLines,
      matchedLines: 0,
      ignoredLines: totalLines,
      shortCircuitedNoViolations: true,
    };
  }

  const rulesById = new Map<string, Rule>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      if (!rulesById.has(rule.id)) {
        rulesById.set(rule.id, rule);
      }
    }
  }

  const lines = text.split('\n');
  let matchedLines = 0;
  for (const line of lines) {
    const match = line.match(/\[([^\]]+)\]\s+(\S+):(\d+)?\s*-\s*(.+)/);
    if (match) {
      matchedLines++;
      const ruleId = match[1];
      const rule = rulesById.get(ruleId);
      violations.push({
        ruleId,
        ruleTitle: rule?.title ?? ruleId,
        severity: rule?.severity ?? 'error',
        file: match[2],
        line: match[3] ? parseInt(match[3], 10) : undefined,
        message: match[4],
      });
    }
  }

  return {
    violations,
    totalLines: lines.length,
    matchedLines,
    ignoredLines: Math.max(0, lines.length - matchedLines),
    shortCircuitedNoViolations: false,
  };
}
