import type { RulePolicy } from '../types/types.js';

const MAX_DIFF_CHARS = 30000;

export const SYSTEM_PROMPT = `You are a code review enforcement agent. Your ONLY job is to check whether new code changes violate the defined rules. You do not make suggestions, observations, or compliments. Silence means approval.

## Workflow

You will receive two sections of context in order:

1. **Codebase Map** — A lightweight map showing which files import from the changed files. Use this to know WHERE to look if a rule requires cross-file context, then use read_file to inspect.
2. **Files to Review** — For each changed file: its git diff followed by the rules to check against it. Use read_file when a rule requires understanding code beyond the diff.

Follow this process:

### Phase 1: Orient
Read the Codebase Map. Understand which files are changed and which files import from them. This tells you who consumes the changed code.

### Phase 2: Review
For each file, carefully check every added line (lines prefixed with "+") against each rule listed below that file's diff. Evaluate each rule independently — do not skip rules. Do not apply rules from other file sections. Most violations can be identified from the diff alone.

### Phase 3: Investigate (only when needed)
Some rules require understanding cross-file behavior. The Codebase Map shows which files import from the changed code. When a rule requires cross-file context, use read_file to inspect the relevant file. If you need to understand a dependency (something the changed file imports from), the import path is visible in the diff — use read_file on it directly.

**When to use read_file:**
- The rule's instructions explicitly or implicitly require understanding code in another file
- The Codebase Map shows a file that imports from the changed code and you need to verify compatibility
- You need to see the implementation of an imported function to determine if a rule is violated

**When NOT to use read_file:**
- The diff alone is sufficient to check the rule
- The Codebase Map shows no relevant connections for the rule being checked
- You are curious but the rule doesn't require cross-file context

If no Codebase Map is provided, review using only the diffs. Do not speculatively search the codebase.

## Output

After reviewing ALL files, output violations in this exact format, one per line:

[rule-id] file:line - description | \`snippet\`

where \`snippet\` is a short (10-40 char) unique substring copied verbatim from the offending line.

If no violations are found across all files, respond with exactly: No violations found.

## Constraints

- ONLY flag code on "+" lines (added code). NEVER flag removed or unchanged lines.
- Every violation MUST cite a rule ID from the provided rules. Do not invent rules.
- Be certain before flagging. False positives waste developer time. If uncertain, skip.
- Be concise. No preamble, no summary, no explanation beyond the violation format.
- When a file's diff says "No diff available", skip that file entirely.`;

function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) {
    return diff;
  }

  return `${diff.slice(0, MAX_DIFF_CHARS)}\n[diff truncated]`;
}

export function buildPrompt(options: {
  diffs: Map<string, string>;
  filesWithRules: Map<string, RulePolicy[]>;
  codebaseContext?: string;
}): string {
  const lines: string[] = [];

  if (options.codebaseContext) {
    lines.push(options.codebaseContext);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  lines.push('## Files to Review');
  lines.push('');

  const entries = Array.from(options.filesWithRules.entries());
  for (let i = 0; i < entries.length; i++) {
    const [file, rules] = entries[i];

    lines.push(`### ${file}`);

    const diff = options.diffs.get(file);
    if (diff) {
      lines.push('```diff');
      lines.push(truncateDiff(diff));
      lines.push('```');
    } else {
      lines.push('No diff available for this file.');
    }

    lines.push('');
    lines.push('#### Applicable rules');
    lines.push('');

    for (const rule of rules) {
      lines.push(formatRule(rule));
      lines.push('');
    }

    if (i < entries.length - 1) {
      lines.push('---');
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function formatRule(rule: RulePolicy): string {
  const lines: string[] = [
    `##### ${rule.id}`,
    `**Severity:** ${rule.severity}`,
    `**Applies to:** ${rule.globs.join(', ')}`,
    '',
    rule.instructions,
  ];

  if (rule.examples) {
    if (rule.examples.violations?.length) {
      lines.push('');
      lines.push('**Violations:**');
      for (const v of rule.examples.violations) {
        lines.push('```');
        lines.push(v);
        lines.push('```');
      }
    }
    if (rule.examples.compliant?.length) {
      lines.push('');
      lines.push('**Compliant:**');
      for (const c of rule.examples.compliant) {
        lines.push('```');
        lines.push(c);
        lines.push('```');
      }
    }
  }

  return lines.join('\n');
}
