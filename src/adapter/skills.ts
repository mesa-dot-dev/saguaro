import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { toKebabCase } from '../lib/constants.js';
import { loadValidatedConfig, resolveApiKey, resolveModelFromResolvedConfig } from '../lib/review-model-config.js';
import { generateRule } from '../lib/rule-generator.js';
import type { PreviewRuleResult } from '../lib/rule-preview.js';
import { previewRule } from '../lib/rule-preview.js';
import {
  computePlacementFromGlobs,
  findRepoRoot,
  loadParsedSkillsFromDirectory,
  parseSkillFiles,
  resolveSkillsDir,
  resolveSkillsDirForCreate,
  validateParsedSkills,
} from '../lib/skills.js';
import { analyzeTarget } from '../lib/target-analysis.js';
import type { RulePolicy, Severity } from '../types/types.js';

export interface AdapterSkill extends RulePolicy {
  name: string;
  description: string;
  skillDir: string;
}

export interface ListSkillsAdapterRequest {
  skillsDir?: string;
}

export interface ListSkillsAdapterResult {
  skillsDir?: string;
  skills: AdapterSkill[];
}

export interface ExplainSkillAdapterRequest {
  skillsDir?: string;
  skillId: string;
}

export interface ExplainSkillAdapterResult {
  skillsDir?: string;
  skill?: AdapterSkill;
}

export interface DeleteSkillAdapterRequest {
  skillId: string;
  skillsDir?: string;
}

export interface DeleteSkillAdapterResult {
  skillsDir: string;
  deleted: boolean;
}

export interface ValidateSkillsAdapterRequest {
  skillsDir?: string;
}

export interface ValidateSkillError {
  file: string;
  errors: string[];
}

export interface ValidateSkillsAdapterResult {
  skillsDir?: string;
  validated: string[];
  errors: ValidateSkillError[];
}

export interface CreateSkillAdapterRequest {
  scope?: string;
  skillsDir?: string;
  title: string;
  description?: string;
  severity: Severity;
  globs: string[];
  instructions: string;
  id?: string;
  repoRoot?: string;
  examples?: {
    violations?: string[];
    compliant?: string[];
  };
}

export interface CreateSkillAdapterResult {
  skillsDir: string;
  skillDir: string;
  skillFilePath: string;
  policyFilePath: string;
  skill: AdapterSkill;
}

export interface GenerateRuleAdapterRequest {
  target: string;
  intent: string;
  title?: string;
  severity?: Severity;
}

export interface GenerateRuleAdapterResult {
  rule: RulePolicy;
  preview: {
    flaggedCount: number;
    passedCount: number;
    flaggedFiles: string[];
    passedFiles: string[];
  };
  placements: {
    label: string;
    scope: string;
    recommended: boolean;
  }[];
}

export interface WrittenRule {
  id: string;
  title: string;
  path: string;
}

export interface WriteGeneratedRulesResult {
  written: WrittenRule[];
}

export interface LocateSkillsDirectoryAdapterResult {
  skillsDir?: string;
}

export function listSkillsAdapter(request: ListSkillsAdapterRequest): ListSkillsAdapterResult {
  const skillsDir = resolveExistingSkillsDirOrEmpty(request.skillsDir);
  if (!skillsDir) {
    return { skillsDir, skills: [] };
  }

  const skills = loadAdapterSkills(skillsDir);
  return { skillsDir, skills };
}

export function explainSkillAdapter(request: ExplainSkillAdapterRequest): ExplainSkillAdapterResult {
  const { skillsDir, skills } = listSkillsAdapter({ skillsDir: request.skillsDir });
  return {
    skillsDir,
    skill: skills.find((skill) => skill.id === request.skillId),
  };
}

export function deleteSkillAdapter(request: DeleteSkillAdapterRequest): DeleteSkillAdapterResult {
  const skillsDir = resolveExistingSkillsDirOrEmpty(request.skillsDir);
  if (!skillsDir) {
    return {
      skillsDir: skillsDir ?? '',
      deleted: false,
    };
  }

  const skillDir = loadAdapterSkills(skillsDir).find((skill) => skill.id === request.skillId)?.skillDir;
  if (!skillDir) {
    return {
      skillsDir,
      deleted: false,
    };
  }

  fs.rmSync(skillDir, { recursive: true, force: true });
  return {
    skillsDir,
    deleted: true,
  };
}

export function validateSkillsAdapter(request: ValidateSkillsAdapterRequest): ValidateSkillsAdapterResult {
  const skillsDir = resolveExistingSkillsDirOrEmpty(request.skillsDir);
  if (!skillsDir) {
    return {
      skillsDir,
      validated: [],
      errors: [{ file: '(skills)', errors: ['Skills directory not found.'] }],
    };
  }

  const { parsed, issues } = parseSkillFiles(skillsDir);
  const semanticIssues = validateParsedSkills(parsed);
  const errors: ValidateSkillError[] = [...issues, ...semanticIssues].map((issue) => ({
    file: issue.filePath,
    errors: [issue.message],
  }));

  const invalidFiles = new Set(errors.map((issue) => issue.file));
  const validated = parsed
    .filter((entry) => !invalidFiles.has(entry.skillFilePath) && !invalidFiles.has(entry.policyFilePath))
    .map((entry) => path.relative(skillsDir, entry.skillDir));

  return {
    skillsDir,
    validated,
    errors,
  };
}

function buildSkillMarkdown(opts: {
  id: string;
  description: string;
  title: string;
  severity: Severity;
  globs: string[];
  instructions: string;
  examples?: { violations?: string[]; compliant?: string[] };
}): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`name: ${opts.id}`);
  lines.push(`description: ${JSON.stringify(opts.description)}`);
  lines.push('---');
  lines.push('');

  // Rule header
  lines.push(`## Rule: ${opts.title}`);
  lines.push('');
  lines.push(`**Severity:** ${opts.severity}`);
  lines.push(`**Target:** ${opts.globs.join(', ')}`);
  lines.push('');

  // Instructions (already has ## sections from the LLM)
  lines.push(opts.instructions);
  lines.push('');

  // Examples
  if (opts.examples?.violations?.length) {
    lines.push('### Violations');
    lines.push('');
    lines.push('```');
    for (const v of opts.examples.violations) {
      lines.push(v);
    }
    lines.push('```');
    lines.push('');
  }

  if (opts.examples?.compliant?.length) {
    lines.push('### Compliant');
    lines.push('');
    lines.push('```');
    for (const c of opts.examples.compliant) {
      lines.push(c);
    }
    lines.push('```');
    lines.push('');
  }

  // Reference to structured policy
  lines.push('Full policy data: [references/mesa-policy.yaml](references/mesa-policy.yaml)');
  lines.push('');

  return lines.join('\n');
}

export function createSkillAdapter(request: CreateSkillAdapterRequest): CreateSkillAdapterResult {
  const repoRoot = request.repoRoot ?? findRepoRoot();
  let skillsDir: string;

  if (request.scope) {
    skillsDir = path.join(repoRoot, request.scope, '.claude', 'skills');
  } else {
    skillsDir = resolveSkillsDirForCreate(request.skillsDir, repoRoot);
  }

  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  const existingIds = new Set(loadAdapterSkills(skillsDir).map((skill) => skill.id));
  const id = request.id ? request.id : toKebabCase(request.title);
  const uniqueId = existingIds.has(id) ? findUniqueSkillId(existingIds, id) : id;

  const skillDir = path.join(skillsDir, uniqueId);
  const referencesDir = path.join(skillDir, 'references');
  fs.mkdirSync(referencesDir, { recursive: true });

  const skillFilePath = path.join(skillDir, 'SKILL.md');
  const policyFilePath = path.join(referencesDir, 'mesa-policy.yaml');

  const policy: RulePolicy = {
    id: uniqueId,
    title: request.title,
    severity: request.severity,
    globs: request.globs,
    instructions: request.instructions,
    ...(request.examples && { examples: request.examples }),
  };

  const description =
    request.description ??
    `${request.title}. Enforces this rule in ${request.globs.join(', ')}. Use when changed code matches this scope and touches behavior covered by the rule. Do not use for unrelated refactors outside scope.`;
  const skillMarkdown = buildSkillMarkdown({
    id: uniqueId,
    description,
    title: request.title,
    severity: request.severity,
    globs: request.globs,
    instructions: request.instructions,
    examples: request.examples,
  });
  fs.writeFileSync(skillFilePath, skillMarkdown);
  fs.writeFileSync(policyFilePath, yaml.dump(policy, { noRefs: true, lineWidth: -1 }));

  return {
    skillsDir,
    skillDir,
    skillFilePath,
    policyFilePath,
    skill: {
      ...policy,
      name: uniqueId,
      description,
      skillDir,
    },
  };
}

export function writeGeneratedRules(rules: RulePolicy[]): WriteGeneratedRulesResult {
  const written: WrittenRule[] = [];

  for (const rule of rules) {
    const scope = computePlacementFromGlobs(rule.globs);
    const created = createSkillAdapter({
      id: rule.id,
      title: rule.title,
      severity: rule.severity,
      globs: rule.globs,
      instructions: rule.instructions,
      scope,
      examples: rule.examples,
    });

    written.push({
      id: created.skill.id,
      title: created.skill.title,
      path: created.skillDir,
    });
  }

  return { written };
}

export async function generateRuleAdapter(request: GenerateRuleAdapterRequest): Promise<GenerateRuleAdapterResult> {
  const repoRoot = findRepoRoot();
  const target = analyzeTarget({ targetPath: request.target, repoRoot });

  const config = loadValidatedConfig();
  const apiKey = resolveApiKey(config);
  const model = resolveModelFromResolvedConfig({
    provider: config.model.provider,
    model: config.model.name,
    apiKey,
  });

  const result = await generateRule({
    intent: request.intent,
    target,
    model,
    title: request.title,
    severity: request.severity,
    repoRoot,
  });

  const violationPatterns = result.policy.examples?.violations ?? [];
  let preview: PreviewRuleResult = {
    flagged: [],
    passed: [],
    totalFiles: 0,
    flaggedCount: 0,
    passedCount: 0,
  };

  if (violationPatterns.length > 0) {
    preview = previewRule({
      targetDir: target.resolvedPath,
      globs: result.policy.globs,
      violationPatterns,
    });
  }

  const placements = target.placements.map((p) => ({
    label: p.label,
    scope: path.relative(repoRoot, path.resolve(p.skillsDir, '..', '..')),
    recommended: p.recommended,
  }));

  return {
    rule: result.policy,
    preview: {
      flaggedCount: preview.flaggedCount,
      passedCount: preview.passedCount,
      flaggedFiles: preview.flagged.map((f) => path.relative(repoRoot, f.filePath)),
      passedFiles: preview.passed.map((f) => path.relative(repoRoot, f.filePath)),
    },
    placements,
  };
}

export function locateSkillsDirectoryAdapter(request: { skillsDir?: string } = {}): LocateSkillsDirectoryAdapterResult {
  const skillsDir = resolveExistingSkillsDirOrEmpty(request.skillsDir);
  return { skillsDir };
}

function loadAdapterSkills(skillsDir: string): AdapterSkill[] {
  return loadParsedSkillsFromDirectory(skillsDir).map((entry) => ({
    ...entry.skill.policy,
    name: entry.skill.name,
    description: entry.skill.description,
    skillDir: entry.skillDir,
  }));
}

function resolveExistingSkillsDirOrEmpty(skillsDir?: string): string | undefined {
  return resolveSkillsDir(skillsDir) ?? undefined;
}

function findUniqueSkillId(existingIds: Set<string>, baseId: string): string {
  let candidate = `${baseId}-2`;
  let i = 3;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${i}`;
    i += 1;
  }

  return candidate;
}
