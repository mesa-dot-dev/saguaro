import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../git/git.js';

export type HookAction = 'install' | 'uninstall';

export interface HookResult {
  action: HookAction;
  settingsPath: string;
  /** True when uninstalling but no settings file existed. */
  noSettingsFound?: boolean;
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

const CLAUDE_SETTINGS_DIR = '.claude';
const CLAUDE_SETTINGS_FILE = 'settings.json';
const HOOK_COMMAND = 'mesa hook run';
const HOOK_TIMEOUT = 120;
const HOOK_STATUS_MESSAGE = 'Mesa: reviewing changes...';
const PRE_TOOL_HOOK_COMMAND = 'mesa hook pre-tool';
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

function getSettingsPath(): string {
  const repoRoot = findRepoRoot();
  return path.join(repoRoot, CLAUDE_SETTINGS_DIR, CLAUDE_SETTINGS_FILE);
}

function readSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) return {};
  const content = fs.readFileSync(settingsPath, 'utf8');
  return JSON.parse(content) as ClaudeSettings;
}

function writeSettings(settingsPath: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function isMesaHookEntry(entry: StopHookEntry): boolean {
  return entry.hooks.some((h) => h.command === HOOK_COMMAND || h.command.endsWith('hook run'));
}

function isMesaPreToolEntry(entry: PreToolUseHookEntry): boolean {
  return entry.hooks.some((h) => h.command === PRE_TOOL_HOOK_COMMAND || h.command.endsWith('hook pre-tool'));
}

function resolveMesaSubcommand(subcommand: string): string {
  try {
    execFileSync('which', ['mesa'], { stdio: 'ignore' });
    return `mesa ${subcommand}`;
  } catch {
    const distBin = path.resolve(findRepoRoot(), 'packages', 'code-review', 'dist', 'cli', 'bin', 'index.js');
    return `node ${distBin} ${subcommand}`;
  }
}

// ---------------------------------------------------------------------------
// Public adapter
// ---------------------------------------------------------------------------

export async function runInstallHook(): Promise<HookResult> {
  const settingsPath = getSettingsPath();
  const settings = readSettings(settingsPath);

  if (!settings.hooks) settings.hooks = {};

  // PreToolUse hook
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
  if (!settings.hooks.PreToolUse.some(isMesaPreToolEntry)) {
    const preToolCommand = resolveMesaSubcommand('hook pre-tool');
    settings.hooks.PreToolUse.push({
      matcher: 'Edit|Write',
      hooks: [{ type: 'command', command: preToolCommand, timeout: PRE_TOOL_TIMEOUT }],
    });
  }

  // Stop hook
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  if (!settings.hooks.Stop.some(isMesaHookEntry)) {
    const hookCommand = resolveMesaSubcommand('hook run');
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

  writeSettings(settingsPath, settings);

  return { action: 'install', settingsPath };
}

export async function runUninstallHook(): Promise<HookResult> {
  const settingsPath = getSettingsPath();

  if (!fs.existsSync(settingsPath)) {
    return { action: 'uninstall', settingsPath, noSettingsFound: true };
  }

  const settings = readSettings(settingsPath);

  // Remove PreToolUse entries
  const preToolHooks = settings.hooks?.PreToolUse;
  if (preToolHooks?.some(isMesaPreToolEntry)) {
    settings.hooks!.PreToolUse = preToolHooks.filter((entry) => !isMesaPreToolEntry(entry));
    if (settings.hooks!.PreToolUse.length === 0) delete settings.hooks!.PreToolUse;
  }

  // Remove Stop entries
  const stopHooks = settings.hooks?.Stop;
  if (stopHooks?.some(isMesaHookEntry)) {
    settings.hooks!.Stop = stopHooks.filter((entry) => !isMesaHookEntry(entry));
    if (settings.hooks!.Stop.length === 0) delete settings.hooks!.Stop;
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;

  writeSettings(settingsPath, settings);

  return { action: 'uninstall', settingsPath };
}
