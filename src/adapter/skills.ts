import fs from 'node:fs';
import path from 'node:path';
import { toKebabCase } from '../lib/constants.js';
import { deleteMesaRuleFile, getMesaRulesDir, loadMesaRules, writeMesaRuleFile } from '../lib/mesa-rules.js';
import { loadValidatedConfig, resolveApiKey, resolveModelFromResolvedConfig } from '../lib/review-model-config.js';
import { generateRule } from '../lib/rule-generator.js';
import type { PreviewRuleResult } from '../lib/rule-preview.js';
import { previewRule } from '../lib/rule-preview.js';
import { syncSkillsFromRules } from '../lib/skill-sync.js';
import { findRepoRoot } from '../lib/skills.js';
import { analyzeTarget } from '../lib/target-analysis.js';
import type { RulePolicy, Severity } from '../types/types.js';

export interface AdapterSkill extends RulePolicy {
  name: string;
  description: string;
  skillDir: string;
}

export interface ListSkillsAdapterResult {
  skills: AdapterSkill[];
}

export interface ExplainSkillAdapterResult {
  skill?: AdapterSkill;
}

export interface DeleteSkillAdapterResult {
  deleted: boolean;
}

export interface ValidateSkillError {
  file: string;
  errors: string[];
}

export interface ValidateSkillsAdapterResult {
  validated: string[];
  errors: ValidateSkillError[];
}

export interface CreateSkillAdapterRequest {
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

export function listSkillsAdapter(): ListSkillsAdapterResult {
  const repoRoot = findRepoRoot();
  const { rules } = loadMesaRules(repoRoot);
  const skills: AdapterSkill[] = rules.map((rule) => ({
    ...rule.policy,
    name: rule.policy.id,
    description: rule.policy.title,
    skillDir: path.join(repoRoot, '.claude', 'skills', rule.policy.id),
  }));
  return { skills };
}

export function explainSkillAdapter(request: { skillId: string }): ExplainSkillAdapterResult {
  const { skills } = listSkillsAdapter();
  return {
    skill: skills.find((skill) => skill.id === request.skillId),
  };
}

export function deleteSkillAdapter(request: { skillId: string }): DeleteSkillAdapterResult {
  const repoRoot = findRepoRoot();
  const ruleFile = path.join(getMesaRulesDir(repoRoot), `${request.skillId}.md`);
  if (!fs.existsSync(ruleFile)) {
    return { deleted: false };
  }
  deleteMesaRuleFile(repoRoot, request.skillId);
  syncSkillsFromRules(repoRoot);
  return { deleted: true };
}

export function validateSkillsAdapter(): ValidateSkillsAdapterResult {
  const repoRoot = findRepoRoot();
  const { rules, errors: parseErrors } = loadMesaRules(repoRoot);

  const errors: ValidateSkillError[] = parseErrors.map((e) => ({
    file: e.filePath,
    errors: [e.message],
  }));

  const errorFiles = new Set(parseErrors.map((e) => e.filePath));
  const validated = rules.filter((rule) => !errorFiles.has(rule.filePath)).map((rule) => rule.policy.id);

  return { validated, errors };
}

export function createSkillAdapter(request: CreateSkillAdapterRequest): CreateSkillAdapterResult {
  const repoRoot = request.repoRoot ?? findRepoRoot();

  // Determine a unique ID
  const { rules } = loadMesaRules(repoRoot);
  const existingIds = new Set(rules.map((r) => r.policy.id));
  const id = request.id ? request.id : toKebabCase(request.title);
  const uniqueId = existingIds.has(id) ? findUniqueSkillId(existingIds, id) : id;

  const policy: RulePolicy = {
    id: uniqueId,
    title: request.title,
    severity: request.severity,
    globs: request.globs,
    instructions: request.instructions,
    ...(request.examples && { examples: request.examples }),
  };

  // Write to .mesa/rules/
  const mesaRuleFilePath = writeMesaRuleFile(repoRoot, policy);

  // Sync to .claude/skills/ and update gitignore
  syncSkillsFromRules(repoRoot);

  const skillsDir = path.join(repoRoot, '.claude', 'skills');
  const skillDir = path.join(skillsDir, uniqueId);
  const skillFilePath = path.join(skillDir, 'SKILL.md');

  const description =
    request.description ??
    `${request.title}. Enforces this rule in ${request.globs.join(', ')}. Use when changed code matches this scope and touches behavior covered by the rule. Do not use for unrelated refactors outside scope.`;

  return {
    skillDir,
    skillFilePath,
    policyFilePath: mesaRuleFilePath,
    skill: {
      ...policy,
      name: uniqueId,
      description,
      skillDir,
    },
  };
}

export function writeGeneratedRules(rules: RulePolicy[]): WriteGeneratedRulesResult {
  const repoRoot = findRepoRoot();
  const written: WrittenRule[] = [];

  for (const rule of rules) {
    const filePath = writeMesaRuleFile(repoRoot, rule);
    written.push({
      id: rule.id,
      title: rule.title,
      path: filePath,
    });
  }

  syncSkillsFromRules(repoRoot);

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

export function locateRulesDirectoryAdapter(): { rulesDir: string } {
  const repoRoot = findRepoRoot();
  return { rulesDir: getMesaRulesDir(repoRoot) };
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
