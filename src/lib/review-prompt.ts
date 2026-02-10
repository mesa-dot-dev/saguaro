import type { Rule } from '../types/types.js';

const MAX_DIFF_CHARS = 30_000;

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated]`;
}

export function buildPrompt(options: {
  diffs: Map<string, string>;
  filesWithRules: Map<string, Rule[]>;
  codebaseContext?: string;
}): string {
  const lines: string[] = [];

  // 1. Codebase map first — structural awareness before any diffs
  if (options.codebaseContext) {
    lines.push(options.codebaseContext);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // 2. Files to review — each file with its applicable rules and diff
  lines.push('## Files to Review');
  lines.push('');

  for (const [file, rules] of options.filesWithRules) {
    const ruleList = rules.map((r) => `${r.id} (${r.severity})`).join(', ');
    lines.push(`### ${file}`);
    lines.push(`Applicable rules: ${ruleList}`);

    const diff = options.diffs.get(file);
    if (diff) {
      lines.push('```diff');
      lines.push(truncateDiff(diff));
      lines.push('```');
    } else {
      lines.push('No diff available for this file.');
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // 3. Full rule definitions
  lines.push('## Rules');
  lines.push('');

  const uniqueRules = new Set<Rule>(Array.from(options.filesWithRules.values()).flat());
  for (const rule of uniqueRules) {
    lines.push(formatRule(rule));
    lines.push('');
  }

  return lines.join('\n');
}

function formatRule(rule: Rule): string {
  const lines: string[] = [
    `### Rule ID: ${rule.id}`,
    `**Severity:** ${rule.severity}`,
    `**Applies to:** ${rule.globs.join(', ')}`,
    '',
    rule.instructions,
  ];

  if (rule.examples) {
    lines.push('');
    if (rule.examples.violations?.length) {
      lines.push(`**Violations:** ${rule.examples.violations.join(', ')}`);
    }
    if (rule.examples.compliant?.length) {
      lines.push(`**Compliant:** ${rule.examples.compliant.join(', ')}`);
    }
  }

  return lines.join('\n');
}
