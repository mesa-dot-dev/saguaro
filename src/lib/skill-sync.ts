import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import type { RulePolicy } from '../types/types.js';
import { loadMesaRules } from './mesa-rules.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncResult {
  generated: string[]; // rule IDs that were synced
  removed: string[]; // rule IDs whose skill dirs were cleaned up
  errors: string[]; // any errors encountered
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILLS_DIR = '.claude/skills';
const GITIGNORE_FILE = '.gitignore';
const POLICY_SIDECAR = 'references/mesa-policy.yaml';
const SKILL_FILE = 'SKILL.md';

const GITIGNORE_BLOCK_START = '# mesa-generated (do not edit this block)';
const GITIGNORE_BLOCK_END = '# end mesa-generated';

// ---------------------------------------------------------------------------
// SKILL.md generation
// ---------------------------------------------------------------------------

function buildSkillMarkdown(policy: RulePolicy): string {
  const globsList = policy.globs.join(', ');
  const description = `${policy.title}. Enforces this rule in ${globsList}. Use when changed code matches this scope and touches behavior covered by the rule. Do not use for unrelated refactors outside scope.`;

  const frontmatter = ['---', `name: ${policy.id}`, `description: ${JSON.stringify(description)}`, '---'].join('\n');

  const body = [
    '',
    `This skill enforces the ${policy.title} policy.`,
    '',
    'Machine-readable policy is defined in references/mesa-policy.yaml.',
    '',
  ].join('\n');

  return frontmatter + body;
}

// ---------------------------------------------------------------------------
// Gitignore management
// ---------------------------------------------------------------------------

/**
 * Build the mesa-managed gitignore block content for the given rule IDs.
 * Returns `null` if there are no rule IDs (block should be removed).
 */
function buildGitignoreBlock(ruleIds: string[]): string | null {
  if (ruleIds.length === 0) return null;

  const sorted = [...ruleIds].sort((a, b) => a.localeCompare(b));
  const lines = [GITIGNORE_BLOCK_START, ...sorted.map((id) => `${SKILLS_DIR}/${id}/`), GITIGNORE_BLOCK_END];
  return lines.join('\n');
}

/**
 * Read, update, and write the `.gitignore` file with the mesa-managed block.
 * - If the block exists, replace it
 * - If not, append it
 * - If no rules remain, remove the block entirely
 */
function updateGitignore(repoRoot: string, ruleIds: string[]): void {
  const gitignorePath = path.join(repoRoot, GITIGNORE_FILE);
  let content = '';

  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }

  const blockPattern = new RegExp(
    `${escapeRegExp(GITIGNORE_BLOCK_START)}[\\s\\S]*?${escapeRegExp(GITIGNORE_BLOCK_END)}`
  );

  const hasExistingBlock = blockPattern.test(content);
  const newBlock = buildGitignoreBlock(ruleIds);

  if (hasExistingBlock) {
    if (newBlock) {
      // Replace existing block
      content = content.replace(blockPattern, newBlock);
    } else {
      // Remove the block entirely (including surrounding blank lines)
      content = content.replace(
        new RegExp(`\\n?${escapeRegExp(GITIGNORE_BLOCK_START)}[\\s\\S]*?${escapeRegExp(GITIGNORE_BLOCK_END)}\\n?`),
        '\n'
      );
      // Clean up trailing whitespace
      content = `${content.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
    }
  } else if (newBlock) {
    // Append the block
    const trimmed = content.trimEnd();
    content = trimmed.length > 0 ? `${trimmed}\n\n${newBlock}\n` : `${newBlock}\n`;
  }

  // Only write if there's actual content or the file already existed
  if (content.trim().length > 0 || fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, content, 'utf8');
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Skill directory management
// ---------------------------------------------------------------------------

/**
 * Write a single skill directory for a rule policy.
 */
function writeSkillDir(repoRoot: string, policy: RulePolicy): void {
  const skillDir = path.join(repoRoot, SKILLS_DIR, policy.id);
  const referencesDir = path.join(skillDir, 'references');

  fs.mkdirSync(referencesDir, { recursive: true });

  // Write SKILL.md
  const skillContent = buildSkillMarkdown(policy);
  fs.writeFileSync(path.join(skillDir, SKILL_FILE), skillContent, 'utf8');

  // Write mesa-policy.yaml
  const policyYaml = yaml.dump(policy, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  });
  fs.writeFileSync(path.join(skillDir, POLICY_SIDECAR), policyYaml, 'utf8');
}

/**
 * Find all mesa-managed skill directories (those that contain `references/mesa-policy.yaml`).
 * Returns a map of rule ID (directory name) to the absolute skill directory path.
 */
function findMesaManagedSkillDirs(repoRoot: string): Map<string, string> {
  const skillsDir = path.join(repoRoot, SKILLS_DIR);
  const managed = new Map<string, string>();

  if (!fs.existsSync(skillsDir)) {
    return managed;
  }

  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsDir, entry.name);
    const policyPath = path.join(skillDir, POLICY_SIDECAR);

    if (fs.existsSync(policyPath)) {
      managed.set(entry.name, skillDir);
    }
  }

  return managed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sync `.claude/skills/<id>/` directories from parsed `.mesa/rules/*.md` files.
 *
 * - Generates a skill directory for each rule
 * - Cleans up orphaned skill directories (mesa-managed but no longer in rules)
 * - Updates `.gitignore` with a mesa-managed block
 */
export function syncSkillsFromRules(repoRoot: string): SyncResult {
  const { rules, errors: parseErrors } = loadMesaRules(repoRoot);

  const generated: string[] = [];
  const removed: string[] = [];
  const errors: string[] = parseErrors.map((e) => `Parse error in ${e.filePath}: ${e.message}`);

  // Build set of current rule IDs
  const currentRuleIds = new Set<string>();
  for (const rule of rules) {
    currentRuleIds.add(rule.policy.id);
  }

  // Generate skill dirs for each rule
  for (const rule of rules) {
    try {
      writeSkillDir(repoRoot, rule.policy);
      generated.push(rule.policy.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to write skill for rule "${rule.policy.id}": ${message}`);
    }
  }

  // Clean up orphaned skill directories
  const existingManaged = findMesaManagedSkillDirs(repoRoot);
  for (const [id, dirPath] of existingManaged) {
    if (!currentRuleIds.has(id)) {
      try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        removed.push(id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`Failed to remove orphaned skill dir "${id}": ${message}`);
      }
    }
  }

  // Update .gitignore
  try {
    updateGitignore(repoRoot, generated);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to update .gitignore: ${message}`);
  }

  return { generated, removed, errors };
}
