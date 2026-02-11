import type { LanguageModel } from 'ai';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { Rule } from '../types/types.js';
import { type ScanContext, serializeScanContext } from './scan.js';

// ---------------------------------------------------------------------------
// Output schema
// ---------------------------------------------------------------------------

const GeneratedRuleSchema = z.object({
  id: z.string().describe('Unique kebab-case rule identifier'),
  title: z.string().describe('Short human-readable title'),
  severity: z.enum(['error', 'warning', 'info']).describe('How severe a violation is'),
  globs: z.array(z.string()).describe('Glob patterns matching files this rule applies to'),
  instructions: z.string().describe('Detailed instructions for an AI agent to enforce this rule when reviewing diffs'),
});

const GeneratedRulesSchema = z.object({
  rules: z.array(GeneratedRuleSchema),
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a code review rule generator. You analyze codebases and produce review rules that catch REAL bugs and enforce REAL conventions — not theoretical best practices.

Every rule you generate will be enforced by an AI agent reviewing git diffs. Rules must be specific enough that the agent can make a clear yes/no judgment on any given diff.

Your rules should be practical, actionable, and grounded in the actual code you see — not generic advice that could apply to any project.`;

function buildUserPrompt(context: ScanContext, count: number): string {
  const serialized = serializeScanContext(context);

  return `${serialized}

## Your Task

Generate ${count} review rules for this project.

Only generate a rule if the code samples give you evidence it matches how this project works. If you're unsure whether the project follows a convention, skip it. ${count} confident rules are better than ${count + 5} speculative ones.

Look for:
- Framework misuse patterns visible in the code samples (e.g., missing cleanup, unhandled async errors)
- Conventions the team already follows that should be enforced (error handling style, validation patterns, module boundaries)
- Dependency-specific pitfalls for this stack (e.g., ORM injection, schema validation gaps)
- Security issues specific to this stack (e.g., unsanitized input, hardcoded credentials)

## What Makes a Bad Rule (DO NOT generate these)

- "Use meaningful variable names" — too vague to enforce
- "Add comments to complex code" — subjective
- "Follow SOLID principles" — not actionable on a diff
- Anything that would fire on 50%+ of files — too noisy
- Rules that duplicate what a linter already catches${context.manifest.hasLinter ? ' (this project has a linter configured)' : ''}

## Rule Requirements

- \`id\` must be unique kebab-case (e.g., "no-raw-sql-interpolation")
- \`globs\` must match THIS project's actual file structure (use the file tree above)
- \`instructions\` must be specific enough that another AI can enforce them by reading a diff
- Each rule must be independently useful — no rules that depend on other rules`;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export async function generateRules(context: ScanContext, model: LanguageModel, count = 8): Promise<Rule[]> {
  const result = await generateObject({
    model,
    schema: GeneratedRulesSchema,
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(context, count),
  });

  return result.object.rules.map((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    globs: r.globs,
    instructions: r.instructions,
  }));
}
