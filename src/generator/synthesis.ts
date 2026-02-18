import type { LanguageModel } from 'ai';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { RulePolicy } from '../types/types.js';
import { RuleProposalSchema } from './types.js';

const SYNTHESIS_PROMPT = `You are a senior engineering lead reviewing candidate code review rules generated from different zones of a codebase.

Your job is to merge duplicates and remove bad rules. Do NOT cut good rules to hit a number — if candidates are distinct and high-quality, keep them all.

## Step 1: Merge Overlapping Candidates

If two candidates describe the same underlying pattern (even across different packages), keep the one with better instructions and broaden its globs to cover both scopes. Do not let the same pattern appear as two separate rules.

## Step 2: Remove Bad Rules

Drop any rule matching these patterns:

**Kitchen sink rules** — A rule that combines multiple unrelated concerns into one. If a rule's instructions contain 3+ distinct "flag X" checks that have nothing to do with each other (e.g., env var conventions AND API request helpers AND redirect sanitization in one rule), it should be split or dropped. Each rule should enforce ONE coherent pattern.

**Generic advice with codebase-specific names** — A rule where the underlying advice is boilerplate that applies to any codebase, just dressed up with specific function/class names from this codebase. Example: "use the logger instead of console.log" is generic advice even if it names the specific logger functions. Test: if you removed the specific names, would the rule still sound like something every codebase should do? If yes, drop it.

**Too niche to trigger** — A rule whose globs match only 1-2 files in the entire codebase. The rule may be technically correct but the surface area is too small to justify including it in a review ruleset.

**Linter/compiler territory** — Rules about formatting, unused imports, type errors, naming conventions, or anything a linter or compiler already catches.

**Vague or unenforceable** — Rules where the instructions don't give a reviewer a concrete thing to look for. "Ensure code quality" or "follow best practices" are not actionable.

**Redundant with a "don't edit" rule** — If one rule says "do not manually edit files matching glob X" (auto-generated code), then any other rule describing patterns *within* those same files is redundant. No PR should be manually changing auto-generated files, so rules about their internal patterns will never trigger. Drop all such subset rules and keep only the "don't edit" rule.

## Step 3: Quality Check Each Surviving Rule

For each rule you keep, verify:
- The instructions describe ONE coherent pattern (not a grab bag)
- A reviewer reading just the instructions would know exactly what to flag
- The globs are scoped to the relevant subsystem (not \`**/*.ts\`)

## Output

Return the consolidated rules. Each rule must have: id, title, severity, globs, instructions.`;

interface SynthesisResult {
  rules: RulePolicy[];
  inputTokens: number;
  outputTokens: number;
}

export async function synthesizeRules(options: {
  candidates: RulePolicy[];
  model: LanguageModel;
  abortSignal?: AbortSignal;
}): Promise<SynthesisResult> {
  const { candidates, model, abortSignal } = options;

  if (candidates.length === 0) {
    return { rules: [], inputTokens: 0, outputTokens: 0 };
  }

  const candidatesSummary = candidates
    .map((r, i) => {
      const parts = [
        `${i + 1}. **${r.id}** (${r.severity})`,
        `   Title: ${r.title}`,
        `   Globs: ${r.globs.join(', ')}`,
        `   Instructions: ${r.instructions}`,
      ];
      return parts.join('\n');
    })
    .join('\n\n');

  const userPrompt = `## ${candidates.length} Candidate Rules

${candidatesSummary}

Merge duplicates and remove bad rules. Keep all distinct, high-quality rules`;

  const result = await generateObject({
    model,
    schema: z.object({
      rules: z.array(RuleProposalSchema),
    }),
    system: SYNTHESIS_PROMPT,
    prompt: userPrompt,
    abortSignal,
  });

  return {
    rules: result.object.rules,
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  };
}
