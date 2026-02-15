import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  loadParsedSkillsFromDirectory,
  parseSkillFiles,
  resolveSkillsDir,
  resolveSkillsDirForCreate,
  validateParsedSkills,
} from '../lib/skills.js';
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
  skillsDir?: string;
  title: string;
  description?: string;
  severity: Severity;
  globs: string[];
  instructions: string;
  id?: string;
}

export interface CreateSkillAdapterResult {
  skillsDir: string;
  skillDir: string;
  skillFilePath: string;
  policyFilePath: string;
  skill: AdapterSkill;
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

export function createSkillAdapter(request: CreateSkillAdapterRequest): CreateSkillAdapterResult {
  const skillsDir = resolveSkillsDirForCreate(request.skillsDir);
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
  };

  const description =
    request.description ??
    `${request.title}. Enforces this rule in ${request.globs.join(', ')}. Use when changed code matches this scope and touches behavior covered by the rule. Do not use for unrelated refactors outside scope.`;
  const skillMarkdown = `---\nname: ${uniqueId}\ndescription: ${description}\n---\n\nThis skill enforces the ${request.title} policy.\n\nPolicy source: references/mesa-policy.yaml\n`;
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

function toKebabCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
