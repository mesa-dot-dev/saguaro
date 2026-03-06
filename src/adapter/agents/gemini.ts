import fs from 'node:fs';
import path from 'node:path';
import type { McpSkillFile } from '../../templates/mcp-skills.js';
import type { AgentAdapter } from './types.js';
import { resolveMesaSubcommand } from './utils.js';

const GEMINI_SETTINGS_DIR = '.gemini';
const GEMINI_SETTINGS_FILE = 'settings.json';
const GEMINI_SKILLS_DIR = '.gemini/skills';
const HOOK_COMMAND = 'mesa hook run';
const HOOK_TIMEOUT = 120;
const HOOK_STATUS_MESSAGE = 'Mesa: reviewing changes...';
const PRE_TOOL_HOOK_COMMAND = 'mesa hook pre-tool';
const PRE_TOOL_TIMEOUT = 10;

interface GeminiSettings {
  hooks?: {
    AfterAgent?: AfterAgentHookEntry[];
    BeforeTool?: BeforeToolHookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface BeforeToolHookEntry {
  matcher: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

interface AfterAgentHookEntry {
  matcher?: string;
  hooks: { type: string; command: string; timeout?: number; statusMessage?: string }[];
}

function settingsPath(repoRoot: string): string {
  return path.join(repoRoot, GEMINI_SETTINGS_DIR, GEMINI_SETTINGS_FILE);
}

function readSettings(filePath: string): GeminiSettings {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as GeminiSettings;
}

function writeSettings(filePath: string, settings: GeminiSettings): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`);
}

function isMesaHookEntry(entry: AfterAgentHookEntry): boolean {
  return entry.hooks.some((h) => h.command === HOOK_COMMAND || h.command.endsWith('hook run'));
}

function isMesaPreToolEntry(entry: BeforeToolHookEntry): boolean {
  return entry.hooks.some((h) => h.command === PRE_TOOL_HOOK_COMMAND || h.command.endsWith('hook pre-tool'));
}

export class GeminiAdapter implements AgentAdapter {
  readonly id = 'gemini' as const;
  readonly label = 'Gemini CLI';
  readonly supportsBlockingHooks = true;
  readonly settingsDir = GEMINI_SETTINGS_DIR;
  readonly skillsDir: string | null = GEMINI_SKILLS_DIR;

  installHooks(repoRoot: string): void {
    const filePath = settingsPath(repoRoot);
    const settings = readSettings(filePath);

    if (!settings.hooks) settings.hooks = {};

    // BeforeTool hook
    if (!settings.hooks.BeforeTool) settings.hooks.BeforeTool = [];
    if (!settings.hooks.BeforeTool.some(isMesaPreToolEntry)) {
      const preToolCommand = resolveMesaSubcommand('hook pre-tool');
      settings.hooks.BeforeTool.push({
        matcher: 'Edit|Write',
        hooks: [{ type: 'command', command: preToolCommand, timeout: PRE_TOOL_TIMEOUT }],
      });
    }

    // AfterAgent hook
    if (!settings.hooks.AfterAgent) settings.hooks.AfterAgent = [];
    if (!settings.hooks.AfterAgent.some(isMesaHookEntry)) {
      const hookCommand = resolveMesaSubcommand('hook run');
      settings.hooks.AfterAgent.push({
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

    // Remove BeforeTool entries
    const beforeToolHooks = settings.hooks?.BeforeTool;
    if (beforeToolHooks?.some(isMesaPreToolEntry)) {
      settings.hooks!.BeforeTool = beforeToolHooks.filter((entry) => !isMesaPreToolEntry(entry));
      if (settings.hooks!.BeforeTool.length === 0) delete settings.hooks!.BeforeTool;
    }

    // Remove AfterAgent entries
    const afterAgentHooks = settings.hooks?.AfterAgent;
    if (afterAgentHooks?.some(isMesaHookEntry)) {
      settings.hooks!.AfterAgent = afterAgentHooks.filter((entry) => !isMesaHookEntry(entry));
      if (settings.hooks!.AfterAgent.length === 0) delete settings.hooks!.AfterAgent;
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
