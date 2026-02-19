import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { RulePolicy } from '../types/types.js';

export interface MesaRuleFile {
  filePath: string;
  policy: RulePolicy;
}

export interface MesaRuleParseError {
  filePath: string;
  message: string;
}

export interface MesaRulesResult {
  rules: MesaRuleFile[];
  errors: MesaRuleParseError[];
}

const RuleFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    severity: z.enum(['error', 'warning', 'info']),
    globs: z.array(z.string()).min(1),
    tags: z.array(z.string()).optional(),
    priority: z.number().int().optional(),
  })
  .strict();

/** Full rule policy schema — used to validate LLM-generated rule YAML. */
export const RulePolicySchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    severity: z.enum(['error', 'warning', 'info']),
    globs: z.array(z.string()).min(1),
    instructions: z.string().min(1),
    examples: z
      .object({
        violations: z.array(z.string()).optional(),
        compliant: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    tags: z.array(z.string()).optional(),
    priority: z.number().int().optional(),
  })
  .strict();

const MESA_RULES_DIR = '.mesa/rules';

const MANAGED_COMMENT = "<!-- This file is managed by Mesa. Edit only if you know what you're doing. -->";

/** Returns the absolute path to `.mesa/rules/` for a given repo root. */
export function getMesaRulesDir(repoRoot: string): string {
  return path.join(repoRoot, MESA_RULES_DIR);
}

/**
 * Strip a leading HTML comment (`<!-- ... -->`) from the raw markdown content.
 * The comment may be followed by optional blank lines before the frontmatter.
 */
function stripLeadingComment(raw: string): string {
  return raw.replace(/^\s*<!--[\s\S]*?-->\s*/, '');
}

/**
 * Extract YAML frontmatter delimited by `---` at the start of the content.
 * Returns `null` if no frontmatter block is found.
 */
function extractFrontmatter(content: string): { yaml: string; body: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  return { yaml: match[1]!, body: match[2]! };
}

/**
 * Parse fenced code blocks under `### Violations` and `### Compliant` headings
 * in the markdown body.
 */
function parseExamples(body: string): { violations?: string[]; compliant?: string[] } | undefined {
  const violations = extractCodeBlocksUnderHeading(body, 'Violations');
  const compliant = extractCodeBlocksUnderHeading(body, 'Compliant');

  if (!violations && !compliant) return undefined;

  const examples: { violations?: string[]; compliant?: string[] } = {};
  if (violations && violations.length > 0) examples.violations = violations;
  if (compliant && compliant.length > 0) examples.compliant = compliant;

  return Object.keys(examples).length > 0 ? examples : undefined;
}

/**
 * Given a markdown body and a heading name (e.g. "Violations"), find the
 * `### <heading>` section and extract all fenced code blocks within it.
 * Stops collecting when a new heading of equal or higher level is found.
 */
function extractCodeBlocksUnderHeading(body: string, heading: string): string[] | undefined {
  // Find the heading (### Violations or ### Compliant)
  const headingPattern = new RegExp(`^###\\s+${heading}\\s*$`, 'm');
  const headingMatch = headingPattern.exec(body);
  if (!headingMatch) return undefined;

  // Get the section content: everything after this heading until the next heading of level <= 3
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const nextHeadingPattern = /^#{1,3}\s+/m;
  const remaining = body.slice(sectionStart);
  const nextHeadingMatch = nextHeadingPattern.exec(remaining);
  const section = nextHeadingMatch ? remaining.slice(0, nextHeadingMatch.index) : remaining;

  // Extract all fenced code blocks from the section
  const codeBlockPattern = /```[^\n]*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = codeBlockPattern.exec(section)) !== null) {
    const content = match[1]!.trim();
    if (content.length > 0) {
      blocks.push(content);
    }
  }

  return blocks.length > 0 ? blocks : undefined;
}

/**
 * Extract the instructions portion of the body — everything before the first
 * `### Violations` or `### Compliant` heading.
 */
function extractInstructions(body: string): string {
  const examplesHeadingPattern = /^###\s+(Violations|Compliant)\s*$/m;
  const match = examplesHeadingPattern.exec(body);
  const instructions = match ? body.slice(0, match.index) : body;
  return instructions.trim();
}

function parseMesaRuleFile(filePath: string, raw: string): MesaRuleFile {
  const stripped = stripLeadingComment(raw);

  const extracted = extractFrontmatter(stripped);
  if (!extracted) {
    throw new Error('Missing YAML frontmatter (expected --- delimiters)');
  }

  let rawFrontmatter: unknown;
  try {
    rawFrontmatter = yaml.load(extracted.yaml, { schema: yaml.DEFAULT_SCHEMA });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML frontmatter: ${message}`);
  }

  const validation = RuleFrontmatterSchema.safeParse(rawFrontmatter);
  if (!validation.success) {
    const details = validation.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid frontmatter: ${details}`);
  }

  const frontmatter = validation.data;
  const instructions = extractInstructions(extracted.body);
  const examples = parseExamples(extracted.body);

  const policy: RulePolicy = {
    id: frontmatter.id,
    title: frontmatter.title,
    severity: frontmatter.severity,
    globs: frontmatter.globs,
    instructions,
    ...(examples ? { examples } : {}),
    ...(frontmatter.tags ? { tags: frontmatter.tags } : {}),
    ...(frontmatter.priority !== undefined ? { priority: frontmatter.priority } : {}),
  };

  return { filePath, policy };
}

export function loadMesaRules(repoRoot: string): MesaRulesResult {
  return loadMesaRulesFromDir(getMesaRulesDir(repoRoot));
}

export function loadMesaRulesFromDir(rulesDir: string): MesaRulesResult {
  const rules: MesaRuleFile[] = [];
  const errors: MesaRuleParseError[] = [];

  if (!fs.existsSync(rulesDir)) {
    return { rules, errors };
  }

  const entries = fs
    .readdirSync(rulesDir)
    .filter((name) => name.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));

  for (const entry of entries) {
    const filePath = path.join(rulesDir, entry);

    // Skip directories that happen to end in .md
    if (!fs.statSync(filePath).isFile()) continue;

    const raw = fs.readFileSync(filePath, 'utf8');
    try {
      rules.push(parseMesaRuleFile(filePath, raw));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ filePath, message });
    }
  }

  return { rules, errors };
}

/** Build the full markdown content string for a rule file. */
export function buildMesaRuleMarkdown(policy: RulePolicy): string {
  const frontmatterObj: Record<string, unknown> = {
    id: policy.id,
    title: policy.title,
    severity: policy.severity,
    globs: policy.globs,
  };

  if (policy.tags && policy.tags.length > 0) {
    frontmatterObj.tags = policy.tags;
  }

  if (policy.priority !== undefined) {
    frontmatterObj.priority = policy.priority;
  }

  const yamlStr = yaml
    .dump(frontmatterObj, {
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
    })
    .trimEnd();

  const parts: string[] = [MANAGED_COMMENT, '---', yamlStr, '---', '', policy.instructions];

  if (policy.examples) {
    if (policy.examples.violations && policy.examples.violations.length > 0) {
      parts.push('');
      parts.push('### Violations');
      parts.push('');
      for (const violation of policy.examples.violations) {
        parts.push('```');
        parts.push(violation);
        parts.push('```');
        parts.push('');
      }
    }

    if (policy.examples.compliant && policy.examples.compliant.length > 0) {
      parts.push('### Compliant');
      parts.push('');
      for (const example of policy.examples.compliant) {
        parts.push('```');
        parts.push(example);
        parts.push('```');
        parts.push('');
      }
    }
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Load rules from a legacy skill directory (<dir>/<id>/references/mesa-policy.yaml)
// ---------------------------------------------------------------------------

/**
 * Read rules from an explicit skill directory (used by `--rules` CLI flag and evals).
 * Each subdirectory should contain `references/mesa-policy.yaml` with a valid RulePolicy.
 */
export function loadRulesFromSkillDir(skillsDir: string): MesaRulesResult {
  const rules: MesaRuleFile[] = [];
  const errors: MesaRuleParseError[] = [];

  if (!fs.existsSync(skillsDir)) {
    return { rules, errors };
  }

  const entries = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const entry of entries) {
    const policyPath = path.join(skillsDir, entry, 'references', 'mesa-policy.yaml');
    if (!fs.existsSync(policyPath)) continue;

    try {
      const raw = yaml.load(fs.readFileSync(policyPath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA });
      const validation = RulePolicySchema.safeParse(raw);
      if (!validation.success) {
        const details = validation.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ');
        errors.push({ filePath: policyPath, message: `Invalid policy: ${details}` });
        continue;
      }
      rules.push({ filePath: policyPath, policy: validation.data });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ filePath: policyPath, message });
    }
  }

  return { rules, errors };
}

/** Write a rule policy to `.mesa/rules/<id>.md`, creating the directory if needed. */
export function writeMesaRuleFile(repoRoot: string, policy: RulePolicy): string {
  const rulesDir = getMesaRulesDir(repoRoot);
  fs.mkdirSync(rulesDir, { recursive: true });

  const filePath = path.join(rulesDir, `${policy.id}.md`);
  const content = buildMesaRuleMarkdown(policy);
  fs.writeFileSync(filePath, content, 'utf8');

  return filePath;
}

/** Remove `.mesa/rules/<id>.md` if it exists. */
export function deleteMesaRuleFile(repoRoot: string, ruleId: string): void {
  const filePath = path.join(getMesaRulesDir(repoRoot), `${ruleId}.md`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
