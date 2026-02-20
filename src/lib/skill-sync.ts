import fs from 'node:fs';
import path from 'node:path';

export interface SyncResult {
  synced: boolean; // whether the mesa-rules skill was written
  errors: string[]; // any errors encountered
}

const SKILLS_DIR = '.claude/skills';
const MESA_SKILL_NAME = 'mesa-rules';
const SKILL_FILE = 'SKILL.md';
const GITIGNORE_FILE = '.gitignore';
const GITIGNORE_BLOCK_START = '# mesa-generated (do not edit this block)';
const GITIGNORE_BLOCK_END = '# end mesa-generated';

const MESA_RULES_SKILL = `---
name: mesa-rules
description: >
  REQUIRED before ANY file edit or creation. Run mesa rules for
  <paths> to load applicable code review rules. Do NOT skip this
  step. If you have not loaded rules for the files you are about
  to modify, you must invoke this skill first.
---

Before editing or creating any files, determine which files and
directories you plan to touch, then run:

    mesa rules for <path1> <path2> ...

You may pass specific files or directories. The command returns
only rules whose globs match the given paths.

Follow ALL returned rules when implementing your changes. If a
rule says not to do something, do not do it.

If you later need to edit files in a different area of the
codebase, run the command again for that scope before proceeding.
`;

function updateGitignore(repoRoot: string): void {
  const gitignorePath = path.join(repoRoot, GITIGNORE_FILE);
  let content = '';

  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, 'utf8');
  }

  const blockPattern = new RegExp(
    `${escapeRegExp(GITIGNORE_BLOCK_START)}[\\s\\S]*?${escapeRegExp(GITIGNORE_BLOCK_END)}`
  );

  const newBlock = [
    GITIGNORE_BLOCK_START,
    `${SKILLS_DIR}/${MESA_SKILL_NAME}/`,
    '.mesa/history/',
    GITIGNORE_BLOCK_END,
  ].join('\n');

  const hasExistingBlock = blockPattern.test(content);

  if (hasExistingBlock) {
    content = content.replace(blockPattern, newBlock);
  } else {
    const trimmed = content.trimEnd();
    content = trimmed.length > 0 ? `${trimmed}\n\n${newBlock}\n` : `${newBlock}\n`;
  }

  fs.writeFileSync(gitignorePath, content, 'utf8');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sync a single `.claude/skills/mesa-rules/SKILL.md` that teaches Claude Code
 * how to discover applicable rules via the `mesa rules for` CLI command.
 */
export function syncSkillsFromRules(repoRoot: string): SyncResult {
  const errors: string[] = [];

  // Write the single mesa-rules skill
  let synced = false;
  try {
    const skillDir = path.join(repoRoot, SKILLS_DIR, MESA_SKILL_NAME);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, SKILL_FILE), MESA_RULES_SKILL, 'utf8');
    synced = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to write mesa-rules skill: ${message}`);
  }

  // Update .gitignore
  try {
    updateGitignore(repoRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Failed to update .gitignore: ${message}`);
  }

  return { synced, errors };
}
