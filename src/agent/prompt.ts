import type { Rule } from '../types/types.js';

export function buildPrompt(options: {
  baseBranch: string;
  headRef: string;
  filesWithRules: Map<string, Rule[]>;
}): string {
  const lines: string[] = [];

  lines.push(`Base branch: ${options.baseBranch}`);
  lines.push(`Head ref: ${options.headRef}`);
  lines.push('');
  lines.push('For each file below, call view_diff with the filepath and base="' + options.baseBranch + '".');
  lines.push('Then check ONLY the added lines ("+") against the listed rules.');
  lines.push('');

  for (const [file, rules] of options.filesWithRules) {
    lines.push(`${file}`);
    for (const rule of rules) {
      lines.push(`  -> ${rule.id} (${rule.severity})`);
    }
  }

  lines.push('');
  lines.push('---');
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
