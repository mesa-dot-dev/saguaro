import fs from 'node:fs';
import path from 'node:path';
import type { McpSkillFile } from '../../templates/mcp-skills.js';
import type { AgentAdapter } from './types.js';
import { resolveSaguaroSubcommand } from './utils.js';

const CLAUDE_SETTINGS_DIR = '.claude';
const CLAUDE_SETTINGS_FILE = 'settings.json';
const CLAUDE_SKILLS_DIR = '.claude/skills';
const HOOK_COMMAND = 'sag hook run';
const HOOK_TIMEOUT = 120;
const HOOK_STATUS_MESSAGE = 'Saguaro: reviewing changes...';
const PRE_TOOL_HOOK_COMMAND = 'sag hook pre-tool';
const PRE_TOOL_TIMEOUT = 10;

interface ClaudeSettings {
  hooks?: {
    Stop?: StopHookEntry[];
    PreToolUse?: PreToolUseHookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface PreToolUseHookEntry {
  matcher: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

interface StopHookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number; statusMessage?: string }[];
}

function settingsPath(repoRoot: string): string {
  return path.join(repoRoot, CLAUDE_SETTINGS_DIR, CLAUDE_SETTINGS_FILE);
}

function readSettings(filePath: string): ClaudeSettings {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as ClaudeSettings;
}

function writeSettings(filePath: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`);
}

function isSaguaroHookEntry(entry: StopHookEntry): boolean {
  return entry.hooks.some((h) => h.command === HOOK_COMMAND || h.command.endsWith('hook run'));
}

function isSaguaroPreToolEntry(entry: PreToolUseHookEntry): boolean {
  return entry.hooks.some((h) => h.command === PRE_TOOL_HOOK_COMMAND || h.command.endsWith('hook pre-tool'));
}

export class ClaudeAdapter implements AgentAdapter {
  readonly id = 'claude' as const;
  readonly label = 'Claude Code';
  readonly supportsBlockingHooks = true;
  readonly settingsDir = CLAUDE_SETTINGS_DIR;
  readonly skillsDir: string | null = CLAUDE_SKILLS_DIR;

  installHooks(repoRoot: string): void {
    const filePath = settingsPath(repoRoot);
    const settings = readSettings(filePath);

    if (!settings.hooks) settings.hooks = {};

    // PreToolUse hook
    if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
    if (!settings.hooks.PreToolUse.some(isSaguaroPreToolEntry)) {
      const preToolCommand = resolveSaguaroSubcommand('hook pre-tool');
      settings.hooks.PreToolUse.push({
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: preToolCommand, timeout: PRE_TOOL_TIMEOUT }],
      });
    }

    // Stop hook
    if (!settings.hooks.Stop) settings.hooks.Stop = [];
    if (!settings.hooks.Stop.some(isSaguaroHookEntry)) {
      const hookCommand = resolveSaguaroSubcommand('hook run');
      settings.hooks.Stop.push({
        hooks: [
          {
            type: 'command',
            command: hookCommand,
            timeout: HOOK_TIMEOUT,
            statusMessage: HOOK_STATUS_MESSAGE,
          },
        ],
      });
    }

    writeSettings(filePath, settings);
  }

  uninstallHooks(repoRoot: string): void {
    const filePath = settingsPath(repoRoot);
    if (!fs.existsSync(filePath)) return;

    const settings = readSettings(filePath);

    // Remove PreToolUse entries
    const preToolHooks = settings.hooks?.PreToolUse;
    if (preToolHooks?.some(isSaguaroPreToolEntry)) {
      settings.hooks!.PreToolUse = preToolHooks.filter((entry) => !isSaguaroPreToolEntry(entry));
      if (settings.hooks!.PreToolUse.length === 0) delete settings.hooks!.PreToolUse;
    }

    // Remove Stop entries
    const stopHooks = settings.hooks?.Stop;
    if (stopHooks?.some(isSaguaroHookEntry)) {
      settings.hooks!.Stop = stopHooks.filter((entry) => !isSaguaroHookEntry(entry));
      if (settings.hooks!.Stop.length === 0) delete settings.hooks!.Stop;
    }

    if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

    writeSettings(filePath, settings);
  }

  writeSkills(repoRoot: string, skills: McpSkillFile[]): void {
    if (!this.skillsDir) return;
    const skillsDirPath = path.join(repoRoot, this.skillsDir);
    for (const skill of skills) {
      const fullPath = path.join(skillsDirPath, skill.skillFilePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, skill.content);
    }
  }
}
