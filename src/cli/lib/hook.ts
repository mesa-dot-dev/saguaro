import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { runInstallHook, runUninstallHook } from '../../adapter/hook.js';
import type { PreToolHookInput } from '../../adapter/hook-runner.js';
import { runHookReview, runPreToolHook } from '../../adapter/hook-runner.js';
import { filterToSessionFiles } from '../../adapter/transcript.js';
import { loadValidatedConfig } from '../../config/model-config.js';
import { checkDaemonWithPolling, formatFindingsForAgent, postReviewToDaemon } from '../../daemon/hook-client.js';
import {
  findRepoRoot,
  getLocalDiffs,
  getRepoRoot,
  getUntrackedDiffs,
  listLocalChangedFilesFromGit,
  listUntrackedFiles,
} from '../../git/git.js';
import { logger } from '../../util/logger.js';

const secondary = chalk.hex('#be3c00');

export async function installHook(): Promise<number> {
  const result = await runInstallHook();
  if (result.agents.length === 0) {
    logger.info(chalk.yellow('No agents detected. Install hooks manually with mesa hook install.'));
  } else {
    for (const agent of result.agents) {
      logger.info(secondary(`${agent.label} hooks installed`));
    }
  }
  return 0;
}

export async function uninstallHook(): Promise<number> {
  const result = await runUninstallHook();
  if (result.agents.length === 0) {
    logger.info(chalk.yellow('No agent settings found. Nothing to uninstall.'));
  } else {
    for (const agent of result.agents) {
      logger.info(secondary(`${agent.label} hooks uninstalled.`));
    }
  }
  return 0;
}

export interface StopHookInput {
  session_id?: string;
  transcript_path?: string;
  last_assistant_message?: string;
  stop_hook_active?: boolean;
  cwd?: string;
  [key: string]: unknown;
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

export interface HookRunArgv {
  config?: string;
  verbose?: boolean;
  /** Injected for testing; production reads stdin. */
  input?: StopHookInput;
}

export async function runHook(argv: HookRunArgv): Promise<number> {
  // Loop prevention: never re-trigger reviews from inside a review agent.
  // The daemon sets MESA_REVIEW_AGENT=1 in the spawned agent's environment.
  if (process.env.MESA_REVIEW_AGENT) {
    return 0;
  }

  const input = argv.input ?? readStdinInput();
  // Loop prevention: if Claude is already fixing violations from a previous
  // Stop hook run, let it finish without re-triggering a review.
  if (input?.stop_hook_active) {
    return 0;
  }

  const config = loadValidatedConfig(argv.config);
  let daemonFindings = '';

  // Daemon mode: check for previous findings AND queue new background review
  if (config.daemon?.enabled) {
    const sessionId = input?.session_id ?? `mesa-${Date.now()}`;

    // Step 1: Check for findings from a PREVIOUS review before queueing new work.
    // This injects findings into the agent's context via exit code 2.
    let pendingFindings = '';
    try {
      const checkResult = await checkDaemonWithPolling(sessionId);
      if (checkResult.status === 'findings') {
        pendingFindings = formatFindingsForAgent(checkResult);
      }
    } catch {
      // Daemon check failure never blocks
    }

    // Step 2: Queue a new review for the current changes (always, regardless of findings)
    const repoRoot = getRepoRoot();
    const localChangedFiles = listLocalChangedFilesFromGit();
    const untrackedFiles = listUntrackedFiles();
    const allFiles = [...new Set([...localChangedFiles, ...untrackedFiles])].filter((f) => !isReviewNoise(f));

    // Filter to only files this session edited (prevents cross-session contamination)
    const transcriptPath = input?.transcript_path as string | undefined;
    const filesToReview = filterToSessionFiles(allFiles, transcriptPath, repoRoot);

    if (filesToReview.length > 0) {
      const localDiffs = getLocalDiffs();
      const untrackedDiffs = getUntrackedDiffs();
      const mergedDiffs = new Map([...localDiffs, ...untrackedDiffs]);

      const changedFiles = filesToReview.map((filePath) => ({
        path: filePath,
        diff_hash: createHash('sha256')
          .update(mergedDiffs.get(filePath) ?? '')
          .digest('hex'),
      }));

      const agentSummary = (input?.last_assistant_message as string) ?? null;

      await postReviewToDaemon({
        sessionId,
        repoPath: repoRoot,
        changedFiles,
        agentSummary,
      });
    }

    // Step 3: If there were daemon findings, capture them.
    // They'll be merged with any rules review findings below.
    if (pendingFindings) {
      daemonFindings = pendingFindings;
    }
  }

  // Rules review: runs inline regardless of daemon mode.
  let rulesReason = '';
  if (config.hook.enabled && config.hook.stop.enabled) {
    const decision = await runHookReview({
      config: argv.config,
      verbose: argv.verbose,
      transcriptPath: input?.transcript_path as string | undefined,
    });

    if (decision.decision === 'block' && decision.reason) {
      rulesReason = decision.reason;
    }
  }

  // Merge daemon findings and rules review results.
  const combinedReason = [daemonFindings, rulesReason].filter(Boolean).join('\n\n');

  if (combinedReason) {
    const response = JSON.stringify({
      decision: 'block',
      reason: combinedReason,
    });
    process.stdout.write(response);
    return 0;
  }

  return 0;
}

export interface PreToolArgv {
  input?: PreToolHookInput;
  repoRoot?: string;
  writeStdout?: (s: string) => void;
}

export async function runPreTool(argv: PreToolArgv): Promise<number> {
  if (process.env.MESA_REVIEW_AGENT) {
    return 0;
  }

  // Read stdin first — session_id is only available in the JSON input from Claude Code
  const input = argv.input ?? readPreToolStdinJson();

  // Daemon findings are now injected via the Stop hook (not PreToolUse).
  // The Stop hook fires after every agent turn and has better coverage
  // than PreToolUse which only fires on Edit|Write.

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

export interface NotifyHookInput {
  type?: string;
  'turn-id'?: string;
  'last-assistant-message'?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function runNotify(argv: { config?: string; verbose?: boolean }): Promise<number> {
  if (process.env.MESA_REVIEW_AGENT) return 0;

  const input = readNotifyStdinJson();
  if (!input) return 0;

  const config = loadValidatedConfig(argv.config);
  if (!config.hook.enabled) return 0;

  const decision = await runHookReview({
    config: argv.config,
    verbose: argv.verbose,
  });

  if (decision.decision === 'block') {
    // Log violations to stderr but don't block (Codex doesn't support blocking)
    process.stderr.write(`[mesa] Review found violations:\n${decision.reason ?? 'Code review found violations.'}\n`);
  }

  return 0;
}

/** Files that should never be sent for review (tool configs, secrets, etc.). */
const REVIEW_NOISE_PATTERNS = ['.mcp.json', '.env', '.env.local', '.DS_Store', 'package-lock.json', 'bun.lockb'];

/** Directory segments that should never be sent for review. */
const REVIEW_NOISE_DIRS = ['.claude', '.mesa', '.gemini', '.codex'];

function isReviewNoise(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (REVIEW_NOISE_PATTERNS.some((p) => basename === p || basename.startsWith('.env.'))) {
    return true;
  }
  const segments = filePath.split('/');
  return segments.some((seg) => REVIEW_NOISE_DIRS.includes(seg));
}

function readNotifyStdinJson(): NotifyHookInput | null {
  try {
    if (process.stdin.isTTY) return null;
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as NotifyHookInput;
  } catch {
    return null;
  }
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
