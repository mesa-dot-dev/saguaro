import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { runHookReview } from '../../lib/hook-runner.js';
import { logger } from '../../lib/logger.js';
import { findRepoRoot } from '../../lib/skills.js';

const CLAUDE_SETTINGS_DIR = '.claude';
const CLAUDE_SETTINGS_FILE = 'settings.json';
const HOOK_COMMAND = 'mesa hook run';
const HOOK_TIMEOUT = 120;
const HOOK_STATUS_MESSAGE = 'Running mesa code review...';

const secondary = chalk.hex('#be3c00');

interface ClaudeSettings {
  hooks?: {
    Stop?: StopHookEntry[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
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

function resolveMesaCommand(): string {
  // Prefer `mesa` if it's on PATH (globally installed via Homebrew, etc.)
  try {
    execFileSync('which', ['mesa'], { stdio: 'ignore' });
    return HOOK_COMMAND;
  } catch {
    const distBin = path.resolve(findRepoRoot(), 'packages', 'code-review', 'dist', 'cli', 'bin', 'index.js');
    return `node ${distBin} hook run`;
  }
}

function buildHookEntry(): StopHookEntry {
  const command = resolveMesaCommand();
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

export async function installHook(): Promise<number> {
  const settingsPath = getSettingsPath();
  const settings = readSettings(settingsPath);

  if (!settings.hooks) {
    settings.hooks = {};
  }

  if (!settings.hooks.Stop) {
    settings.hooks.Stop = [];
  }

  const alreadyInstalled = settings.hooks.Stop.some(isMesaHookEntry);
  if (alreadyInstalled) {
    logger.info(chalk.yellow('Mesa hook is already installed.'));
    return 0;
  }

  settings.hooks.Stop.push(buildHookEntry());
  writeSettings(settingsPath, settings);

  logger.info(secondary('Mesa review Claude Code hook installed.'));

  return 0;
}

export async function uninstallHook(): Promise<number> {
  const settingsPath = getSettingsPath();

  if (!fs.existsSync(settingsPath)) {
    logger.info(chalk.yellow('No .claude/settings.json found. Nothing to uninstall.'));
    return 0;
  }

  const settings = readSettings(settingsPath);
  const stopHooks = settings.hooks?.Stop;

  if (!stopHooks?.some(isMesaHookEntry)) {
    logger.info(chalk.yellow('Mesa hook is not installed. Nothing to uninstall.'));
    return 0;
  }

  settings.hooks!.Stop = stopHooks.filter((entry) => !isMesaHookEntry(entry));
  if (settings.hooks!.Stop.length === 0) {
    delete settings.hooks!.Stop;
  }

  if (Object.keys(settings.hooks!).length === 0) {
    delete settings.hooks;
  }

  writeSettings(settingsPath, settings);

  const relPath = path.relative(process.cwd(), settingsPath);
  logger.info(secondary('Mesa hook uninstalled successfully.'));
  logger.info(chalk.gray(`  Updated: ${relPath}`));

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
