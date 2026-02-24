import type { LanguageModel } from 'ai';
import { generateText } from 'ai';
import yaml from 'js-yaml';
import { STARTER_RULES } from '../templates/starter-rules.js';
import type { RulePolicy, Severity } from '../types/types.js';
import { type CodebaseSnippet, toKebabCase } from './constants.js';
import { RulePolicySchema } from './mesa-rules.js';
import type { TargetAnalysis } from './target-analysis.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

interface BuildPromptInput {
  intent: string;
  target: TargetAnalysis;
  fewShotExamples: RulePolicy[];
  title?: string;
  severity?: Severity;
}

export interface GenerateRuleRequest {
  intent: string;
  target: TargetAnalysis;
  model: LanguageModel;
  title?: string;
  severity?: Severity;
  repoRoot: string;
  debugLog?: (label: string, content: string) => void;
}

export interface GenerateRuleResult {
  policy: RulePolicy;
  inferredTitle: string;
  inferredSeverity: Severity;
}

type ParseResult = { success: true; policy: RulePolicy } | { success: false; error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FEW_SHOT = 3;
const MIN_FEW_SHOT = 2;

const SYSTEM_PROMPT = `You are a code review rule generator. Your ONLY job is to produce a single YAML document that defines a code review rule policy.

Output ONLY the raw YAML document. Do NOT wrap it in markdown code fences. Do NOT add any explanation, preamble, or commentary before or after the YAML.

The YAML must conform to this exact schema:

id: <kebab-case identifier>
title: <human-readable title>
severity: <error | warning | info>
globs:
  - <file glob pattern>
instructions: |
  ## What to Look For
  <what patterns/code to flag>

  ## Why This Matters
  <impact of violations>

  ## Correct Patterns
  <what compliant code looks like>

  ## Exceptions
  <when it's acceptable to not follow the rule>
examples:
  violations:
    - <short code snippet 10-60 chars showing a violation>
  compliant:
    - <short code snippet 10-60 chars showing correct code>
tags:
  - <lowercase-hyphenated-tag>

Rules:
- The instructions field MUST contain these four sections: "What to Look For", "Why This Matters", "Correct Patterns", "Exceptions"
- Violation and compliant examples must be real code snippets between 10 and 60 characters
- Tags must be lowercase and hyphenated (e.g., "type-safety", "error-handling")
- The id must be kebab-case
- Output raw YAML only — no markdown fences, no explanation`;

// ---------------------------------------------------------------------------
// selectFewShotExamples
// ---------------------------------------------------------------------------

/**
 * Picks 2-3 starter rules most relevant to the user's intent using keyword
 * matching against tags and titles.
 */
export function selectFewShotExamples(intent: string): RulePolicy[] {
  const intentTokens = tokenize(intent);

  const scored = STARTER_RULES.map((rule) => {
    const ruleTokens = [...tokenize(rule.title), ...(rule.tags ?? []).flatMap((tag) => tag.split('-'))];
    const score = intentTokens.reduce(
      (acc, token) => acc + (ruleTokens.some((rt) => rt.includes(token) || token.includes(rt)) ? 1 : 0),
      0
    );
    return { rule: rule as RulePolicy, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Always return at least MIN_FEW_SHOT, at most MAX_FEW_SHOT
  const topCount = Math.max(MIN_FEW_SHOT, Math.min(MAX_FEW_SHOT, scored.filter((s) => s.score > 0).length));

  return scored.slice(0, topCount).map((s) => s.rule);
}

// ---------------------------------------------------------------------------
// buildRuleGenerationPrompt
// ---------------------------------------------------------------------------

/**
 * Builds the user prompt for rule generation using TargetAnalysis.
 * Provides grounded context including directory tree, target files, and boundary files.
 */
export function buildRuleGenerationPrompt(input: BuildPromptInput): string {
  const sections: string[] = [];

  sections.push('## Rule Request');
  sections.push('');
  sections.push(`**Intent:** ${input.intent}`);
  if (input.title) sections.push(`**Title:** ${input.title}`);
  if (input.severity) sections.push(`**Severity:** ${input.severity}`);
  sections.push(`**Target:** ${input.target.relativePath}`);
  sections.push(`**Suggested globs:** ${input.target.suggestedGlobs.join(', ')}`);
  sections.push(`**Detected languages:** ${input.target.detectedLanguages.join(', ')}`);
  sections.push('');

  // Directory structure section
  sections.push('---');
  sections.push('');
  sections.push('## Directory Structure');
  sections.push('');
  sections.push('This shows where the target code lives relative to its siblings:');
  sections.push('');
  sections.push('```');
  sections.push(input.target.directoryTree);
  sections.push('```');
  sections.push('');

  // Target code section
  if (input.target.files.length > 0) {
    sections.push('---');
    sections.push('');
    sections.push('## Target Code');
    sections.push('');
    sections.push('These files are from the target directory. The rule will check code like this:');
    sections.push('');
    for (const file of input.target.files) {
      sections.push(`### ${file.filePath}`);
      sections.push('```');
      sections.push(file.content);
      sections.push('```');
      sections.push('');
    }
  }

  // Boundary code section
  if (input.target.boundaryFiles.length > 0) {
    sections.push('---');
    sections.push('');
    sections.push('## Surrounding Code');
    sections.push('');
    sections.push('These files are from neighboring directories. They provide architectural context:');
    sections.push('');
    for (const file of input.target.boundaryFiles) {
      sections.push(`### ${file.filePath}`);
      sections.push('```');
      sections.push(file.content);
      sections.push('```');
      sections.push('');
    }
  }

  // Few-shot examples
  if (input.fewShotExamples.length > 0) {
    sections.push('---');
    sections.push('');
    sections.push('## Reference Examples');
    sections.push('');
    sections.push(
      'Below are existing high-quality rule policies. Study their structure and produce output in the same YAML format.'
    );
    sections.push('');
    for (const example of input.fewShotExamples) {
      sections.push(`### Example: ${example.title}`);
      sections.push('```yaml');
      sections.push(yaml.dump(example, { noRefs: true, lineWidth: -1 }).trim());
      sections.push('```');
      sections.push('');
    }
  }

  sections.push('---');
  sections.push('');
  sections.push('## Output Requirements');
  sections.push('');
  sections.push('Generate a YAML rule policy document. The instructions MUST include these four sections:');
  sections.push('1. **What to Look For** - specific code patterns to flag');
  sections.push('2. **Why This Matters** - impact and reasoning');
  sections.push('3. **Correct Patterns** - what compliant code looks like');
  sections.push('4. **Exceptions** - when violations are acceptable');
  sections.push('');
  if (!input.title) {
    sections.push('Infer a concise, descriptive title for this rule based on the intent and code.');
  }
  if (!input.severity) {
    sections.push('Infer an appropriate severity (error, warning, or info) based on the intent.');
  }
  sections.push('');
  sections.push('Use the suggested globs as the target globs for the rule.');
  sections.push(
    'Ground your violation and compliant examples in the ACTUAL code shown above — do NOT invent import paths or function names that do not exist in the codebase.'
  );
  sections.push('');
  sections.push('Output ONLY raw YAML. No markdown fences, no explanation.');

  return sections.join('\n');
}

// ---------------------------------------------------------------------------
// parseGeneratedPolicy
// ---------------------------------------------------------------------------

/**
 * Parses LLM output as YAML, strips markdown code fences, validates against
 * RulePolicySchema.
 */
export function parseGeneratedPolicy(text: string): ParseResult {
  const cleaned = stripCodeFences(text).trim();

  let parsed: unknown;
  try {
    parsed = yaml.load(cleaned, { schema: yaml.DEFAULT_SCHEMA });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `YAML parse error: ${message}` };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { success: false, error: 'Expected a YAML object, got a non-object value' };
  }

  const validation = RulePolicySchema.safeParse(parsed);
  if (!validation.success) {
    const details = validation.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return { success: false, error: `Schema validation failed: ${details}` };
  }

  return { success: true, policy: validation.data };
}

// ---------------------------------------------------------------------------
// generateRule (orchestrator)
// ---------------------------------------------------------------------------

/**
 * Orchestrates rule generation using TargetAnalysis:
 * select examples -> build prompt from target -> call LLM -> parse -> override fields.
 */
export async function generateRule(request: GenerateRuleRequest): Promise<GenerateRuleResult> {
  const log = request.debugLog;
  const fewShotExamples = selectFewShotExamples(request.intent);

  log?.('Few-shot examples selected', fewShotExamples.map((e) => e.id).join(', '));
  log?.('Target files', request.target.files.map((s) => s.filePath).join(', ') || '(none)');
  log?.('Boundary files', request.target.boundaryFiles.map((s) => s.filePath).join(', ') || '(none)');

  const prompt = buildRuleGenerationPrompt({
    intent: request.intent,
    target: request.target,
    fewShotExamples,
    title: request.title,
    severity: request.severity,
  });

  log?.('System prompt', SYSTEM_PROMPT);
  log?.('User prompt', prompt);

  const result = await generateText({
    model: request.model,
    system: SYSTEM_PROMPT,
    prompt,
  });

  const text = result.text;
  log?.('Raw LLM response', text);

  const parseResult = parseGeneratedPolicy(text);

  if (!parseResult.success) {
    log?.('Parse error', parseResult.error);
    throw new Error(`Failed to parse generated rule: ${parseResult.error}`);
  }

  log?.('Parsed policy', yaml.dump(parseResult.policy, { noRefs: true, lineWidth: -1 }));

  const policy: RulePolicy = {
    ...parseResult.policy,
    id: toKebabCase(request.title ?? parseResult.policy.title),
    title: request.title ?? parseResult.policy.title,
    severity: request.severity ?? parseResult.policy.severity,
    globs: request.target.suggestedGlobs,
  };

  log?.('Final policy (after overrides)', yaml.dump(policy, { noRefs: true, lineWidth: -1 }));

  return {
    policy,
    inferredTitle: parseResult.policy.title,
    inferredSeverity: parseResult.policy.severity,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length > 2);
}

function stripCodeFences(text: string): string {
  // Remove opening fence (```yaml or ```)
  let cleaned = text.replace(/^```(?:yaml|yml)?\s*\n/m, '');
  // Remove closing fence
  cleaned = cleaned.replace(/\n```\s*$/m, '');
  return cleaned;
}
