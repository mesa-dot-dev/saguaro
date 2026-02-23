import { z } from 'zod';

export const RuleProposalSchema = z.object({
  id: z.string().describe('Kebab-case rule ID (e.g., "no-raw-sql-interpolation")'),
  title: z.string().describe('Short human-readable title'),
  severity: z.enum(['error', 'warning', 'info']),
  globs: z.array(z.string()).describe('File glob patterns this rule applies to'),
  instructions: z.string().describe('What to flag and why — be specific'),
  examples: z
    .object({
      violations: z.array(z.string()).optional().describe('Code snippets (10-120 chars) showing violations'),
      compliant: z.array(z.string()).optional().describe('Code snippets (10-120 chars) showing correct code'),
    })
    .optional()
    .describe('Concrete code examples of violations and compliant patterns'),
  tags: z
    .array(z.string())
    .optional()
    .describe('Lowercase hyphenated tags for categorization (e.g., "architecture", "security")'),
});

export const TriageDecisionSchema = z.object({
  keep: z.array(z.string()).describe('Rule IDs to keep as-is'),
  drop: z.array(z.string()).describe('Rule IDs to remove'),
  merge: z.array(
    z.object({
      target: z.string().describe('ID of the rule to keep as the merged result'),
      sources: z.array(z.string()).describe('IDs of rules being merged into the target'),
      reason: z.string().describe('Brief explanation of why these rules overlap'),
    })
  ),
});
