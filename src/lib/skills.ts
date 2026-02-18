import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { z } from 'zod';
import type { RulePolicy, SkillDefinition } from '../types/types.js';

const SkillFrontmatterSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().min(1).max(1024),
    'argument-hint': z.string().optional(),
    'disable-model-invocation': z.boolean().optional(),
    'user-invocable': z.boolean().optional(),
    'allowed-tools': z.string().optional(),
    model: z.string().optional(),
    context: z.string().optional(),
    agent: z.string().optional(),
    hooks: z.unknown().optional(),
  })
  .passthrough();

export const SkillPolicySchema = z
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

const SKILL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export interface ParsedSkillFile {
  skillDir: string;
  skillFilePath: string;
  policyFilePath: string;
  skill: SkillDefinition;
}

export interface SkillFileIssue {
  filePath: string;
  message: string;
}

export interface SkillsResolutionResult {
  filesWithRules: Map<string, RulePolicy[]>;
  rulesLoaded: number;
  discoveredSkillDirs: string[];
}

export function findRepoRoot(startDir = process.cwd()): string {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    if (fs.existsSync(path.join(currentDir, '.git'))) {
      return currentDir;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return path.resolve(startDir);
}

export function resolveSkillsDir(explicitSkillsDir?: string, startDir = process.cwd()): string | null {
  if (explicitSkillsDir) {
    const resolved = path.resolve(explicitSkillsDir);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Skills directory not found: ${explicitSkillsDir}`);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new Error(`Skills path is not a directory: ${explicitSkillsDir}`);
    }
    return resolved;
  }

  const repoRoot = findRepoRoot(startDir);
  const defaultSkillsDir = path.join(repoRoot, '.claude', 'skills');
  return fs.existsSync(defaultSkillsDir) ? defaultSkillsDir : null;
}

export function resolveSkillsDirForCreate(explicitSkillsDir?: string, startDir = process.cwd()): string {
  if (explicitSkillsDir) {
    return path.resolve(explicitSkillsDir);
  }
  return resolveSkillsDir(undefined, startDir) ?? path.resolve(findRepoRoot(startDir), '.claude', 'skills');
}

export function parseSkillFiles(skillsDir: string): { parsed: ParsedSkillFile[]; issues: SkillFileIssue[] } {
  const parsed: ParsedSkillFile[] = [];
  const issues: SkillFileIssue[] = [];

  if (!fs.existsSync(skillsDir)) {
    return { parsed, issues };
  }

  const entries = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const entry of entries) {
    const skillDir = path.join(skillsDir, entry);
    const skillFilePath = path.join(skillDir, 'SKILL.md');
    const policyFilePath = path.join(skillDir, 'references', 'mesa-policy.yaml');

    if (!fs.existsSync(skillFilePath)) {
      continue;
    }
    if (!fs.existsSync(policyFilePath)) {
      // Ignore generic Claude skills that are not policy-backed rule skills.
      continue;
    }

    const skillMarkdown = fs.readFileSync(skillFilePath, 'utf8');
    const frontmatter = extractFrontmatter(skillMarkdown);
    if (!frontmatter) {
      issues.push({ filePath: skillFilePath, message: 'Missing YAML frontmatter in SKILL.md' });
      continue;
    }

    let rawFrontmatter: unknown;
    try {
      rawFrontmatter = yaml.load(frontmatter, { schema: yaml.DEFAULT_SCHEMA });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ filePath: skillFilePath, message: `Failed to parse frontmatter: ${message}` });
      continue;
    }

    const frontmatterValidation = SkillFrontmatterSchema.safeParse(rawFrontmatter);
    if (!frontmatterValidation.success) {
      const details = frontmatterValidation.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      issues.push({ filePath: skillFilePath, message: `Invalid SKILL.md frontmatter: ${details}` });
      continue;
    }

    let rawPolicy: unknown;
    try {
      rawPolicy = yaml.load(fs.readFileSync(policyFilePath, 'utf8'), { schema: yaml.DEFAULT_SCHEMA });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ filePath: policyFilePath, message: `Failed to parse mesa-policy.yaml: ${message}` });
      continue;
    }

    const policyValidation = SkillPolicySchema.safeParse(rawPolicy);
    if (!policyValidation.success) {
      const details = policyValidation.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      issues.push({ filePath: policyFilePath, message: `Invalid mesa-policy schema: ${details}` });
      continue;
    }

    parsed.push({
      skillDir,
      skillFilePath,
      policyFilePath,
      skill: {
        name: frontmatterValidation.data.name,
        description: frontmatterValidation.data.description,
        skillDir,
        skillFilePath,
        policyFilePath,
        policy: policyValidation.data,
      },
    });
  }

  return { parsed, issues };
}

export function loadParsedSkillsFromDirectory(skillsDir: string): ParsedSkillFile[] {
  const { parsed, issues } = parseSkillFiles(skillsDir);
  if (issues.length > 0) {
    const details = issues.map((issue) => `${issue.filePath}: ${issue.message}`).join('\n');
    throw new Error(`Failed to load skill files:\n${details}`);
  }
  return parsed;
}

export function validateParsedSkills(parsed: ParsedSkillFile[]): SkillFileIssue[] {
  const errors: SkillFileIssue[] = [];
  const ids = new Set<string>();

  for (const entry of parsed) {
    if (!SKILL_ID_PATTERN.test(entry.skill.policy.id)) {
      errors.push({
        filePath: entry.policyFilePath,
        message: 'invalid id (kebab-case)',
      });
      continue;
    }

    if (ids.has(entry.skill.policy.id)) {
      errors.push({
        filePath: entry.policyFilePath,
        message: `duplicate id: ${entry.skill.policy.id}`,
      });
      continue;
    }

    ids.add(entry.skill.policy.id);
  }

  return errors;
}

export function resolveSkillsForFiles(
  changedFiles: string[],
  options?: { explicitSkillsDir?: string; startDir?: string }
): SkillsResolutionResult {
  const startDir = options?.startDir ?? process.cwd();
  const repoRoot = findRepoRoot(startDir);
  const parsedBySkillsDir = new Map<string, ParsedSkillFile[]>();
  const discoveredSkillDirs = new Set<string>();
  const filesWithRules = new Map<string, RulePolicy[]>();
  const loadedSkillFiles = new Set<string>();

  const explicitSkillsDir = options?.explicitSkillsDir ? path.resolve(options.explicitSkillsDir) : null;

  for (const file of changedFiles) {
    const definitions = new Map<string, SkillDefinition>();
    const skillDirs = explicitSkillsDir ? [explicitSkillsDir] : listAncestorSkillDirs(repoRoot, file);

    for (const skillsDir of skillDirs) {
      discoveredSkillDirs.add(skillsDir);

      let parsed = parsedBySkillsDir.get(skillsDir);
      if (!parsed) {
        parsed = loadParsedSkillsFromDirectory(skillsDir);
        parsedBySkillsDir.set(skillsDir, parsed);
      }

      for (const entry of parsed) {
        loadedSkillFiles.add(entry.skillFilePath);
        if (!matchesSkillGlobs(file, entry.skill.policy.globs)) {
          continue;
        }
        definitions.set(entry.skill.policy.id, entry.skill);
      }
    }

    const resolvedSkills = Array.from(definitions.values()).sort(compareSkills);
    if (resolvedSkills.length > 0) {
      filesWithRules.set(
        file,
        resolvedSkills.map((skill) => skill.policy)
      );
    }
  }

  return {
    filesWithRules,
    rulesLoaded: loadedSkillFiles.size,
    discoveredSkillDirs: Array.from(discoveredSkillDirs).sort((a, b) => a.localeCompare(b)),
  };
}

const GLOB_WILDCARD_CHARS = /[*?{[]/;
export function computePlacementFromGlobs(globs: string[]): string | undefined {
  const positiveGlobs = globs.filter((g) => !g.startsWith('!'));

  const staticPrefixes: string[] = [];
  for (const glob of positiveGlobs) {
    const segments = glob.split('/');
    const staticSegments: string[] = [];
    for (const segment of segments) {
      if (GLOB_WILDCARD_CHARS.test(segment)) break;
      staticSegments.push(segment);
    }
    if (staticSegments.length > 0) {
      staticPrefixes.push(staticSegments.join('/'));
    }
  }

  if (staticPrefixes.length === 0) return undefined;

  const firstSegments = staticPrefixes[0]!.split('/');
  const commonSegments: string[] = [];

  for (let i = 0; i < firstSegments.length; i++) {
    const segment = firstSegments[i]!;
    if (staticPrefixes.every((prefix) => prefix.split('/')[i] === segment)) {
      commonSegments.push(segment);
    } else {
      break;
    }
  }

  if (commonSegments.length === 0) return undefined;
  const lastSegment = commonSegments[commonSegments.length - 1]!;
  if (lastSegment.includes('.') && !GLOB_WILDCARD_CHARS.test(lastSegment)) {
    commonSegments.pop();
  }

  if (commonSegments.length === 0) return undefined;

  return commonSegments.join('/');
}

function extractFrontmatter(markdown: string): string | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match ? match[1] : null;
}

function listAncestorSkillDirs(repoRoot: string, filePath: string): string[] {
  const absoluteFilePath = path.resolve(repoRoot, filePath);
  const targetDir = path.dirname(absoluteFilePath);
  if (!targetDir.startsWith(repoRoot)) {
    return [];
  }

  const ancestors: string[] = [];
  let currentDir = repoRoot;

  while (targetDir.startsWith(currentDir)) {
    ancestors.push(currentDir);
    if (currentDir === targetDir) {
      break;
    }

    const relative = path.relative(currentDir, targetDir);
    const nextSegment = relative.split(path.sep)[0];
    const nextDir = path.join(currentDir, nextSegment);
    if (nextDir === currentDir) {
      break;
    }
    currentDir = nextDir;
  }

  return ancestors
    .map((ancestor) => path.join(ancestor, '.claude', 'skills'))
    .filter((skillsDir) => fs.existsSync(skillsDir) && fs.statSync(skillsDir).isDirectory());
}

function matchesSkillGlobs(filePath: string, globs: string[]): boolean {
  let matched = false;
  let excluded = false;

  for (const glob of globs) {
    if (glob.startsWith('!')) {
      if (minimatch(filePath, glob.slice(1))) {
        excluded = true;
      }
      continue;
    }

    if (minimatch(filePath, glob)) {
      matched = true;
    }
  }

  return matched && !excluded;
}

function compareSkills(a: SkillDefinition, b: SkillDefinition): number {
  const priorityA = a.policy.priority ?? 0;
  const priorityB = b.policy.priority ?? 0;
  if (priorityA !== priorityB) {
    return priorityB - priorityA;
  }

  const byId = a.policy.id.localeCompare(b.policy.id);
  if (byId !== 0) {
    return byId;
  }

  return a.skillDir.localeCompare(b.skillDir);
}
