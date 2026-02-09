import fs from 'node:fs';
import path from 'node:path';
import {
  loadParsedRulesFromDirectory,
  type ParsedRuleFile,
  parseRuleFiles,
  resolveRulesDir,
  resolveRulesDirForCreate,
  validateParsedRules,
} from '../lib/rules.js';
import type { Rule, Severity } from '../types/types.js';

export interface AdapterRule extends Rule {
  filename: string;
}

export interface ListRulesAdapterRequest {
  rulesDir?: string;
}

export interface ListRulesAdapterResult {
  rulesDir?: string;
  rules: AdapterRule[];
}

export interface ExplainRuleAdapterRequest {
  rulesDir?: string;
  ruleId: string;
}

export interface ExplainRuleAdapterResult {
  rulesDir?: string;
  rule?: AdapterRule;
}

export interface DeleteRuleAdapterRequest {
  ruleId: string;
  rulesDir?: string;
}

export interface DeleteRuleAdapterResult {
  rulesDir: string;
  deleted: boolean;
}

export interface ValidateRulesAdapterRequest {
  rulesDir?: string;
}

export interface ValidateRuleError {
  file: string;
  errors: string[];
}

export interface ValidateRulesAdapterResult {
  rulesDir?: string;
  validated: string[];
  errors: ValidateRuleError[];
}

export interface CreateRuleAdapterRequest {
  rulesDir?: string;
  title: string;
  severity: Severity;
  globs: string[];
  instructions: string;
  id?: string;
}

export interface CreateRuleAdapterResult {
  rulesDir: string;
  filename: string;
  filePath: string;
  rule: Rule;
}

export interface LocateRulesDirectoryAdapterResult {
  rulesDir?: string;
}

export function listRulesAdapter(request: ListRulesAdapterRequest): ListRulesAdapterResult {
  const rulesDir = resolveExistingRulesDirOrEmpty(request.rulesDir);
  if (!rulesDir) {
    return { rulesDir, rules: [] };
  }

  const rules = loadAdapterRules(rulesDir);
  return { rulesDir, rules };
}

export function explainRuleAdapter(request: ExplainRuleAdapterRequest): ExplainRuleAdapterResult {
  const { rulesDir, rules } = listRulesAdapter({ rulesDir: request.rulesDir });
  return {
    rulesDir,
    rule: rules.find((rule) => rule.id === request.ruleId),
  };
}

export function deleteRuleAdapter(request: DeleteRuleAdapterRequest): DeleteRuleAdapterResult {
  const rulesDir = resolveExistingRulesDirOrEmpty(request.rulesDir);
  if (!rulesDir) {
    return {
      rulesDir: rulesDir ?? '',
      deleted: false,
    };
  }

  const ruleFile = loadAdapterRules(rulesDir).find((rule) => rule.id === request.ruleId)?.filename;
  if (!ruleFile) {
    return {
      rulesDir,
      deleted: false,
    };
  }

  fs.unlinkSync(path.join(rulesDir, ruleFile));
  return {
    rulesDir,
    deleted: true,
  };
}

export function validateRulesAdapter(request: ValidateRulesAdapterRequest): ValidateRulesAdapterResult {
  const rulesDir = resolveExistingRulesDirOrEmpty(request.rulesDir);
  if (!rulesDir) {
    return {
      rulesDir,
      validated: [],
      errors: [{ file: '(rules)', errors: ['Rules directory not found.'] }],
    };
  }

  const { parsed, issues } = parseRuleFiles(rulesDir);
  const semanticIssues = validateParsedRules(parsed);
  const errors: ValidateRuleError[] = [...issues, ...semanticIssues].map((issue) => ({
    file: issue.filename,
    errors: [issue.message],
  }));
  const invalidFiles = new Set(semanticIssues.map((issue) => issue.filename));
  const validated = parsed.filter((entry) => !invalidFiles.has(entry.filename)).map((entry) => entry.filename);

  return {
    rulesDir,
    validated,
    errors,
  };
}

export function createRuleAdapter(request: CreateRuleAdapterRequest): CreateRuleAdapterResult {
  const rulesDir = resolveRulesDirForCreate(request.rulesDir);

  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
  }

  const existingIds = new Set(loadAdapterRules(rulesDir).map((rule) => rule.id));
  const id = request.id ? request.id : toKebabCase(request.title);
  const uniqueId = existingIds.has(id) ? findUniqueRuleId(existingIds, id) : id;

  const rule: Rule = {
    id: uniqueId,
    title: request.title,
    severity: request.severity,
    globs: request.globs,
    instructions: request.instructions,
  };

  const filename = buildUniqueFilename(rulesDir, uniqueId);
  const filePath = path.join(rulesDir, filename);
  const yaml = toRuleYaml(rule);
  fs.writeFileSync(filePath, yaml);

  return {
    rulesDir,
    filename,
    filePath,
    rule,
  };
}

export function locateRulesDirectoryAdapter(request: { rulesDir?: string } = {}): LocateRulesDirectoryAdapterResult {
  const rulesDir = resolveExistingRulesDirOrEmpty(request.rulesDir);
  return { rulesDir };
}

function loadAdapterRules(rulesDir: string): AdapterRule[] {
  return loadParsedRulesFromDirectory(rulesDir).map(toAdapterRule);
}

function toAdapterRule(entry: ParsedRuleFile): AdapterRule {
  return {
    ...entry.rule,
    filename: entry.filename,
  };
}

function resolveExistingRulesDirOrEmpty(rulesDir?: string): string | undefined {
  return resolveRulesDir(rulesDir) ?? undefined;
}

function toKebabCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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

function buildUniqueFilename(rulesDir: string, baseName: string): string {
  let candidate = `${baseName}.yaml`;
  let i = 2;

  while (fs.existsSync(path.join(rulesDir, candidate))) {
    candidate = `${baseName}-${i}.yaml`;
    i += 1;
  }

  return candidate;
}

function toRuleYaml(rule: Rule): string {
  const globs = rule.globs.map((glob) => `  - ${glob}`).join('\n');
  const instructions = rule.instructions
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return [
    `id: ${rule.id}`,
    `title: ${JSON.stringify(rule.title)}`,
    `severity: ${rule.severity}`,
    'globs:',
    globs,
    'instructions: |',
    instructions,
    '',
  ].join('\n');
}
