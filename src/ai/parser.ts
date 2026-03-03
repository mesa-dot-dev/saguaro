import type { RulePolicy, Violation } from '../types/types.js';

export interface ParseViolationsResult {
  violations: Violation[];
  totalLines: number;
  matchedLines: number;
  ignoredLines: number;
  shortCircuitedNoViolations: boolean;
}

function snapLine(
  resolveFile: (path: string) => string | null,
  filePath: string,
  reportedLine: number,
  snippet: string,
  window = 10
): number {
  const content = resolveFile(filePath);
  if (!content) return reportedLine;

  const lines = content.split('\n');
  const start = Math.max(0, reportedLine - window - 1);
  const end = Math.min(lines.length, reportedLine + window);

  for (let i = start; i < end; i++) {
    if (lines[i].includes(snippet.trim())) return i + 1;
  }
  return reportedLine;
}

export function parseViolationsDetailed(
  text: string,
  filesWithRules: Map<string, RulePolicy[]>,
  resolveFile: (path: string) => string | null
): ParseViolationsResult {
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

  const rulesById = new Map<string, RulePolicy>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      if (!rulesById.has(rule.id)) {
        rulesById.set(rule.id, rule);
      }
    }
  }

  const SNIPPET_REGEX = /\[([^\]]+)\]\s+(\S+):(\d+)?\s*-\s*(.+?)\s*\|\s*`([^`]+)`/;
  const FALLBACK_REGEX = /\[([^\]]+)\]\s+(\S+):(\d+)?\s*-\s*(.+)/;

  const lines = text.split('\n');
  let matchedLines = 0;
  for (const line of lines) {
    const match = line.match(SNIPPET_REGEX) ?? line.match(FALLBACK_REGEX);
    if (match) {
      matchedLines++;
      const ruleId = match[1];
      const rule = rulesById.get(ruleId);
      const reportedLine = match[3] ? parseInt(match[3], 10) : undefined;
      const snippet = match[5]; // undefined if FALLBACK_REGEX matched
      const message = snippet ? match[4] : match[4].replace(/\s*\|\s*`[^`]*`\s*$/, '');

      violations.push({
        ruleId,
        ruleTitle: rule?.title ?? ruleId,
        severity: rule?.severity ?? 'error',
        file: match[2],
        line:
          reportedLine !== undefined && snippet ? snapLine(resolveFile, match[2], reportedLine, snippet) : reportedLine,
        message,
      });
    }
  }

  const shortCircuitedNoViolations = violations.length === 0 && isNoViolationsSentinel(text);

  return {
    violations,
    totalLines: lines.length,
    matchedLines,
    ignoredLines: shortCircuitedNoViolations ? lines.length : Math.max(0, lines.length - matchedLines),
    shortCircuitedNoViolations,
  };
}

function isNoViolationsSentinel(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === 'no violations found' || normalized === 'no violations found.';
}

export function deduplicateViolations(violations: Violation[]): Violation[] {
  const seen = new Map<string, Violation>();
  for (const v of violations) {
    const key = `${v.ruleId}::${v.file}::${v.line ?? ''}`;
    if (!seen.has(key)) {
      seen.set(key, v);
    }
  }
  return Array.from(seen.values());
}
