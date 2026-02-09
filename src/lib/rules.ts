import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { Rule } from '../types/types.js';

const RuleSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    severity: z.enum(['error', 'warning', 'info']),
    globs: z.array(z.string()),
    instructions: z.string().min(1),
    examples: z
      .object({
        violations: z.array(z.string()).optional(),
        compliant: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export interface ParsedRuleFile {
  filename: string;
  filePath: string;
  rule: Rule;
}

export interface RuleFileIssue {
  filename: string;
  filePath: string;
  message: string;
}

const RULE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export function findMesaDir(startDir = process.cwd()): string | null {
  let currentDir = startDir;
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const mesaDir = path.join(currentDir, '.mesa');
    if (fs.existsSync(mesaDir)) {
      return mesaDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

export function resolveRulesDir(explicitRulesDir?: string, startDir = process.cwd()): string | null {
  if (explicitRulesDir) {
    if (!fs.existsSync(explicitRulesDir)) {
      throw new Error(`Rules directory not found: ${explicitRulesDir}`);
    }

    const stats = fs.statSync(explicitRulesDir);
    if (!stats.isDirectory()) {
      throw new Error(`Rules path is not a directory: ${explicitRulesDir}`);
    }

    return explicitRulesDir;
  }

  const mesaDir = findMesaDir(startDir);
  if (!mesaDir) {
    return null;
  }

  const rulesDir = path.join(mesaDir, 'rules');
  return fs.existsSync(rulesDir) ? rulesDir : null;
}

export function loadRulesFromDirectory(rulesDir: string): Rule[] {
  return loadParsedRulesFromDirectory(rulesDir).map((entry) => entry.rule);
}

export function loadParsedRulesFromDirectory(rulesDir: string): ParsedRuleFile[] {
  const { parsed, issues } = parseRuleFiles(rulesDir);
  if (issues.length > 0) {
    const issueMessages = issues.map((issue) => `${issue.filename}: ${issue.message}`).join('\n');
    throw new Error(`Failed to load rule files:\n${issueMessages}`);
  }

  return parsed;
}

export function parseRuleFiles(rulesDir: string): { parsed: ParsedRuleFile[]; issues: RuleFileIssue[] } {
  const filenames = fs.readdirSync(rulesDir).filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'));
  const parsed: ParsedRuleFile[] = [];
  const issues: RuleFileIssue[] = [];

  for (const filename of filenames) {
    const filePath = path.join(rulesDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');

    let raw: unknown;
    try {
      raw = yaml.load(content, { schema: yaml.DEFAULT_SCHEMA });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      issues.push({ filename, filePath, message: `Failed to parse YAML: ${message}` });
      continue;
    }

    if (!raw || typeof raw !== 'object') {
      issues.push({ filename, filePath, message: 'Expected a YAML object' });
      continue;
    }

    const validation = RuleSchema.safeParse(raw);
    if (!validation.success) {
      const formatted = validation.error.issues
        .map((issue) => {
          const pathText = issue.path.length > 0 ? issue.path.join('.') : '(root)';
          return `${pathText}: ${issue.message}`;
        })
        .join('; ');
      issues.push({ filename, filePath, message: `Invalid rule schema: ${formatted}` });
      continue;
    }

    parsed.push({ filename, filePath, rule: validation.data });
  }

  return { parsed, issues };
}

export function validateParsedRules(parsed: ParsedRuleFile[]): RuleFileIssue[] {
  const issues: RuleFileIssue[] = [];
  const ids = new Set<string>();

  for (const entry of parsed) {
    if (!RULE_ID_PATTERN.test(entry.rule.id)) {
      issues.push({
        filename: entry.filename,
        filePath: entry.filePath,
        message: 'invalid id (kebab-case)',
      });
      continue;
    }

    if (ids.has(entry.rule.id)) {
      issues.push({
        filename: entry.filename,
        filePath: entry.filePath,
        message: `duplicate id: ${entry.rule.id}`,
      });
      continue;
    }

    ids.add(entry.rule.id);
  }

  return issues;
}

export function loadConfiguredRules(explicitRulesDir?: string, startDir = process.cwd()): Rule[] {
  const rulesDir = resolveRulesDir(explicitRulesDir, startDir);
  if (!rulesDir) {
    return [];
  }

  return loadRulesFromDirectory(rulesDir);
}

export function resolveRulesDirForCreate(explicitRulesDir?: string, startDir = process.cwd()): string {
  return resolveRulesDir(explicitRulesDir, startDir) ?? path.resolve(startDir, '.mesa/rules');
}
