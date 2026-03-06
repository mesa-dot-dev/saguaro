import fs from 'node:fs';
import path from 'node:path';
import {
  loadValidatedConfig,
  resolveApiKey,
  resolveModelForReview,
  resolveModelFromResolvedConfig,
} from '../config/model-config.js';
import { findRepoRoot } from '../git/git.js';
import { generateRule } from '../rules/generator.js';
import { deleteMesaRuleFile, getMesaRulesDir, loadMesaRules, writeMesaRuleFile } from '../rules/mesa-rules.js';
import type { PreviewRuleResult } from '../rules/preview.js';
import { previewRule } from '../rules/preview.js';
import { analyzeTarget } from '../rules/target-analysis.js';
import type { RulePolicy, Severity } from '../types/types.js';
import { toKebabCase } from '../util/constants.js';

export interface ListRulesAdapterResult {
  rules: RulePolicy[];
}

export interface ExplainRuleAdapterResult {
  rule?: RulePolicy;
}

export interface DeleteRuleAdapterResult {
  deleted: boolean;
}

export interface ValidateRuleError {
  file: string;
  errors: string[];
}

export interface ValidateRulesAdapterResult {
  validated: string[];
  errors: ValidateRuleError[];
}

export interface CreateRuleAdapterRequest {
  title: string;
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

export interface CreateRuleAdapterResult {
  policyFilePath: string;
  rule: RulePolicy;
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

export function listRulesAdapter(): ListRulesAdapterResult {
  const repoRoot = findRepoRoot();
  const { rules } = loadMesaRules(repoRoot);
  return { rules: rules.map((rule) => rule.policy) };
}

export function explainRuleAdapter(request: { ruleId: string }): ExplainRuleAdapterResult {
  const { rules } = listRulesAdapter();
  return {
    rule: rules.find((rule) => rule.id === request.ruleId),
  };
}

export function deleteRuleAdapter(request: { ruleId: string }): DeleteRuleAdapterResult {
  const repoRoot = findRepoRoot();
  const ruleFile = path.join(getMesaRulesDir(repoRoot), `${request.ruleId}.md`);
  if (!fs.existsSync(ruleFile)) {
    return { deleted: false };
  }
  deleteMesaRuleFile(repoRoot, request.ruleId);
  return { deleted: true };
}

export function validateRulesAdapter(): ValidateRulesAdapterResult {
  const repoRoot = findRepoRoot();
  const { rules, errors: parseErrors } = loadMesaRules(repoRoot);

  const errors: ValidateRuleError[] = parseErrors.map((e) => ({
    file: e.filePath,
    errors: [e.message],
  }));

  const errorFiles = new Set(parseErrors.map((e) => e.filePath));
  const validated = rules.filter((rule) => !errorFiles.has(rule.filePath)).map((rule) => rule.policy.id);

  return { validated, errors };
}

export function createRuleAdapter(request: CreateRuleAdapterRequest): CreateRuleAdapterResult {
  const repoRoot = request.repoRoot ?? findRepoRoot();

  // Determine a unique ID
  const { rules } = loadMesaRules(repoRoot);
  const existingIds = new Set(rules.map((r) => r.policy.id));
  const id = request.id ? request.id : toKebabCase(request.title);
  const uniqueId = existingIds.has(id) ? findUniqueRuleId(existingIds, id) : id;

  const policy: RulePolicy = {
    id: uniqueId,
    title: request.title,
    severity: request.severity,
    globs: request.globs,
    instructions: request.instructions,
    ...(request.examples && { examples: request.examples }),
  };

  // Write to .mesa/rules/
  const policyFilePath = writeMesaRuleFile(repoRoot, policy);

  return {
    policyFilePath,
    rule: policy,
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

  return { written };
}

export async function generateRuleAdapter(request: GenerateRuleAdapterRequest): Promise<GenerateRuleAdapterResult> {
  const repoRoot = findRepoRoot();
  const target = analyzeTarget({ targetPath: request.target, repoRoot });

  const config = loadValidatedConfig();
  const apiKey = resolveApiKey(config);
  const modelName = resolveModelForReview(config, 'rules');
  const model = resolveModelFromResolvedConfig({
    provider: config.model.provider,
    model: modelName,
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

function findUniqueRuleId(existingIds: Set<string>, baseId: string): string {
  let candidate = `${baseId}-2`;
  let i = 3;
  while (existingIds.has(candidate)) {
    candidate = `${baseId}-${i}`;
    i += 1;
  }

  return candidate;
}
