import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { PreToolHookInput } from '../../lib/hook-runner.js';
import { runHookReview, runPreToolHook } from '../../lib/hook-runner.js';
import { logger } from '../../lib/logger.js';
import { loadValidatedConfig } from '../../lib/review-model-config.js';
import { findRepoRoot } from '../../lib/rule-resolution.js';

const CLAUDE_SETTINGS_DIR = '.claude';
const CLAUDE_SETTINGS_FILE = 'settings.json';
const HOOK_COMMAND = 'mesa hook run';
const HOOK_TIMEOUT = 120;
const HOOK_STATUS_MESSAGE = 'Mesa: reviewing changes...';
const PRE_TOOL_HOOK_COMMAND = 'mesa hook pre-tool';
const PRE_TOOL_TIMEOUT = 10;

const secondary = chalk.hex('#be3c00');

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
  hooks: {
    type: string;
    command: string;
    timeout?: number;
  }[];
}

interface StopHookEntry {
  matcher?: string;
  hooks: {
    type: string;
    command: string;
    timeout?: number;
    statusMessage?: string;
  }[];
}

export interface StopHookInput {
  stop_hook_active?: boolean;
  [key: string]: unknown;
}

function getSettingsPath(): string {
  const repoRoot = findRepoRoot();
  return path.join(repoRoot, CLAUDE_SETTINGS_DIR, CLAUDE_SETTINGS_FILE);
}

function readSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  const content = fs.readFileSync(settingsPath, 'utf8');
  return JSON.parse(content) as ClaudeSettings;
}

function writeSettings(settingsPath: string, settings: ClaudeSettings): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function readStdinInput(): StopHookInput | null {
  try {
    if (process.stdin.isTTY) {
      return null;
    }
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) {
      return null;
    }
    return JSON.parse(raw) as StopHookInput;
  } catch {
    return null;
  }
}

function isMesaHookEntry(entry: StopHookEntry): boolean {
  return entry.hooks.some((h) => h.command === HOOK_COMMAND || h.command.endsWith('hook run'));
}

function resolveMesaSubcommand(subcommand: string): string {
  // Prefer `mesa` if it's on PATH (globally installed via Homebrew, etc.)
  try {
    execFileSync('which', ['mesa'], { stdio: 'ignore' });
    return `mesa ${subcommand}`;
  } catch {
    const distBin = path.resolve(findRepoRoot(), 'packages', 'code-review', 'dist', 'cli', 'bin', 'index.js');
    return `node ${distBin} ${subcommand}`;
  }
}

function buildHookEntry(): StopHookEntry {
  const command = resolveMesaSubcommand('hook run');
  return {
    hooks: [
      {
        type: 'command',
        command,
        timeout: HOOK_TIMEOUT,
        statusMessage: HOOK_STATUS_MESSAGE,
      },
    ],
  };
}

function isMesaPreToolEntry(entry: PreToolUseHookEntry): boolean {
  return entry.hooks.some((h) => h.command === PRE_TOOL_HOOK_COMMAND || h.command.endsWith('hook pre-tool'));
}

function buildPreToolHookEntry(): PreToolUseHookEntry {
  const command = resolveMesaSubcommand('hook pre-tool');
  return {
    matcher: 'Edit|Write',
    hooks: [{ type: 'command', command, timeout: PRE_TOOL_TIMEOUT }],
  };
}

export async function installHook(): Promise<number> {
  const settingsPath = getSettingsPath();
  const settings = readSettings(settingsPath);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Install PreToolUse hook
  if (!settings.hooks.PreToolUse) {
    settings.hooks.PreToolUse = [];
  }
  if (!settings.hooks.PreToolUse.some(isMesaPreToolEntry)) {
    settings.hooks.PreToolUse.push(buildPreToolHookEntry());
  }

  // Install Stop hook
  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }
  if (!settings.hooks.Stop.some(isMesaHookEntry)) {
    settings.hooks.Stop.push(buildHookEntry());
  }

  writeSettings(settingsPath, settings);

  logger.info(secondary('Mesa hooks installed (PreToolUse + Stop).'));
  return 0;
}

export async function uninstallHook(): Promise<number> {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    logger.info(chalk.yellow('No .claude/settings.json found. Nothing to uninstall.'));
    return 0;
  }

  const settings = readSettings(settingsPath);

  // Remove PreToolUse entries
  const preToolHooks = settings.hooks?.PreToolUse;
  if (preToolHooks?.some(isMesaPreToolEntry)) {
    settings.hooks!.PreToolUse = preToolHooks.filter((entry) => !isMesaPreToolEntry(entry));
    if (settings.hooks!.PreToolUse.length === 0) {
      delete settings.hooks!.PreToolUse;
    }
  }

  // Remove Stop entries
  const stopHooks = settings.hooks?.Stop;
  if (stopHooks?.some(isMesaHookEntry)) {
    settings.hooks!.Stop = stopHooks.filter((entry) => !isMesaHookEntry(entry));
    if (settings.hooks!.Stop.length === 0) {
      delete settings.hooks!.Stop;
    }
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settingsPath, settings);
  logger.info(secondary('Mesa hooks uninstalled.'));
  return 0;
}

export interface HookRunArgv {
  config?: string;
  verbose?: boolean;
  /** Injected for testing; production reads stdin. */
  input?: StopHookInput;
}

export async function runHook(argv: HookRunArgv): Promise<number> {
  const input = argv.input ?? readStdinInput();
  // Loop prevention: if Claude is already fixing violations from a previous
  // Stop hook run, let it finish without re-triggering a review.
  if (input?.stop_hook_active) {
    return 0;
  }

  const config = loadValidatedConfig(argv.config);
  if (!config.hook.enabled || !config.hook.stop.enabled) {
    return 0;
  }

  const decision = await runHookReview({
    config: argv.config,
    verbose: argv.verbose,
  });

  if (decision.decision === 'block') {
    // Exit code 2 tells Claude Code to block and provide feedback
    process.stderr.write(decision.reason ?? 'Code review found violations.');
    return 2;
  }
  return 0;
}

export interface PreToolArgv {
  input?: PreToolHookInput;
  repoRoot?: string;
  writeStdout?: (s: string) => void;
}

export function runPreTool(argv: PreToolArgv): number {
  const input = argv.input ?? readPreToolStdinJson();
  if (!input) return 0;

  const repoRoot = argv.repoRoot ?? findRepoRoot();
  const result = runPreToolHook({ input, repoRoot });

  const filePath = input.tool_input?.file_path ?? 'unknown';
  if (result.matchedCount > 0) {
    console.error(`[mesa] PreToolUse: ${result.matchedCount} rules matched for ${filePath}`);
  }

  if (result.stdout) {
    const write = argv.writeStdout ?? ((s: string) => process.stdout.write(s));
    write(result.stdout);
  }

  return result.exitCode;
}

function readPreToolStdinJson(): PreToolHookInput | null {
  try {
    if (process.stdin.isTTY) return null;
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as PreToolHookInput;
  } catch (err) {
    console.error(`[mesa] Failed to read PreToolUse stdin: ${err}`);
    return null;
  }
}
