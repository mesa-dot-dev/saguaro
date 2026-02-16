import type { LanguageModel } from 'ai';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { RulePolicy } from '../types/types.js';
import { RuleProposalSchema } from './types.js';

const SYNTHESIS_PROMPT = `You are a senior engineering lead reviewing candidate code review rules generated from different zones of a codebase.

Your job is to consolidate these candidates into a clean final ruleset.

## What To Do

1. **Merge overlapping candidates** — If two candidates describe the same underlying pattern, keep the one with better instructions and broaden its globs.
2. **Remove bad candidates:**
   - Rules that describe what one specific function does (too narrow)
   - Rules too narrow to be useful — globs targeting a single file path
   - Rules duplicating linter/formatter/compiler functionality
   - Vague or unenforceable rules ("ensure code quality")
   - Generic best practices that apply to any codebase (e.g., "don't commit secrets", "use HTTPS", "validate input"). Only keep rules that reflect patterns specific to the codebase that produced these candidates.
   - Meta/self-referential rules
3. **Keep genuinely distinct and useful rules** — Don't cut rules just to hit a number. It's better to return more high-quality rules than to cut good ones to meet a target.
4. **Rules that name specific code artifacts are grounded** — If a rule's instructions reference specific class names, constants, function names, or file paths, it was derived from actual code. Prefer keeping these even if the title sounds like generic advice.

## Glob Scoping

If a rule uses universal globs like \`**/*.ts\`, either narrow the globs to the subsystem where the pattern applies or drop it.

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
  ruleTarget: number;
  abortSignal?: AbortSignal;
}): Promise<SynthesisResult> {
  const { candidates, model, ruleTarget, abortSignal } = options;

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

Consolidate these into a final ruleset. Target ~${ruleTarget} final rules. Keep only distinct, high-quality rules.`;

  const result = await generateObject({
    model,
    schema: z.object({
      rules: z.array(RuleProposalSchema),
    }),
    system: SYNTHESIS_PROMPT,
    prompt: userPrompt,
    abortSignal,
  });

  // Hard cap — prompt says target but we enforce in code
  const rules = result.object.rules.slice(0, ruleTarget + 5);

  return {
    rules,
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  };
}
