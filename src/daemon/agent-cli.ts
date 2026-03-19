import { execFile, spawn, spawnSync } from 'node:child_process';
import {
  buildClaudeArgs,
  buildClaudeEnv,
  buildCodexArgs,
  buildCodexEnv,
  buildGeminiArgs,
  buildGeminiEnv,
} from '../ai/agent-runner.js';
import type { AgentUsage } from './stats-types.js';

export type AgentName = 'claude' | 'codex' | 'gemini' | 'copilot' | 'opencode' | 'cursor';

export interface AgentOutput {
  text: string;
  usage?: AgentUsage;
}

export function parseAgentJsonOutput(raw: string): AgentOutput {
  try {
    const data = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || typeof data.result !== 'string') {
      return { text: data?.result ?? '' };
    }
    const usage: AgentUsage | undefined =
      typeof data.total_cost_usd === 'number'
        ? {
            costUsd: data.total_cost_usd,
            inputTokens: data.usage?.input_tokens ?? 0,
            outputTokens: data.usage?.output_tokens ?? 0,
            numTurns: data.num_turns ?? 0,
          }
        : undefined;
    return { text: data.result, usage };
  } catch {
    return { text: raw };
  }
}

const AGENT_COMMANDS: Record<AgentName, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
  copilot: 'github-copilot-cli',
  opencode: 'opencode',
  cursor: 'cursor',
};

const DETECTION_ORDER: AgentName[] = ['claude', 'codex', 'gemini', 'opencode', 'copilot', 'cursor'];

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MB = 10 * 1024 * 1024;

function isCommandInstalled(command: string): boolean {
  const result = spawnSync('which', [command], { stdio: 'pipe', timeout: 5000 });
  return result.status === 0;
}

/**
 * Detects which agent CLI is available on the system.
 *
 * If `preference` is provided and is not 'auto', checks only that specific agent.
 * Otherwise scans the detection order for the first installed agent.
 */
export function detectInstalledAgent(preference?: string): AgentName | null {
  if (preference && preference !== 'auto') {
    const name = preference as AgentName;
    const command = AGENT_COMMANDS[name];
    if (!command) return null;
    return isCommandInstalled(command) ? name : null;
  }

  for (const name of DETECTION_ORDER) {
    const command = AGENT_COMMANDS[name];
    if (isCommandInstalled(command)) {
      return name;
    }
  }

  return null;
}

/**
 * Invokes the given agent CLI with a review prompt and returns an AgentOutput
 * containing the text output and optional usage/cost data (for Claude JSON mode).
 * Async — does not block the Node.js event loop, allowing the HTTP server to stay responsive.
 *
 * Uses the same arg builders as the non-daemon reviewer to ensure consistent
 * flags (--no-session-persistence, etc.).
 *
 * Effort is set to 'medium' (vs 'low' for inline reviews) because the daemon
 * runs in the background with no user waiting on it, so it can afford deeper
 * reasoning without impacting perceived latency.
 */
export async function invokeAgent(agent: AgentName, prompt: string, cwd: string, model?: string): Promise<AgentOutput> {
  const command = AGENT_COMMANDS[agent];

  switch (agent) {
    case 'claude': {
      const args = buildClaudeArgs({
        model,
        allowedTools: ['Read', 'Glob', 'Grep'],
        maxTurns: 15,
        effort: 'medium',
        outputFormat: 'json',
      });
      const raw = await spawnAsync(command, args, {
        cwd,
        input: prompt,
        env: buildClaudeEnv(process.env),
        encoding: 'utf8',
        maxBuffer: TEN_MB,
        timeout: FIVE_MINUTES_MS,
      });
      return parseAgentJsonOutput(raw);
    }

    case 'codex': {
      const args = buildCodexArgs({ cwd, model, reasoningEffort: 'medium' });
      const raw = await spawnAsync(command, args, {
        cwd,
        input: prompt,
        env: buildCodexEnv(process.env),
        encoding: 'utf8',
        maxBuffer: TEN_MB,
        timeout: FIVE_MINUTES_MS,
      });
      return { text: raw };
    }

    case 'gemini': {
      const args = buildGeminiArgs({ model });
      const raw = await spawnAsync(command, args, {
        cwd,
        input: prompt,
        env: buildGeminiEnv(process.env),
        encoding: 'utf8',
        maxBuffer: TEN_MB,
        timeout: FIVE_MINUTES_MS,
      });
      return { text: raw };
    }

    default: {
      const raw = await execFileAsync(command, ['-p', prompt], {
        cwd,
        env: { ...process.env, SAGUARO_REVIEW_AGENT: '1' },
        encoding: 'utf8',
        maxBuffer: TEN_MB,
        timeout: FIVE_MINUTES_MS,
      });
      return { text: raw };
    }
  }
}

interface ExecOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  encoding: BufferEncoding;
  maxBuffer: number;
  timeout: number;
}

function execFileAsync(command: string, args: string[], options: ExecOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout) => {
      if (error) {
        reject(error);
      } else {
        resolve(stdout);
      }
    });
  });
}

interface SpawnOptions extends ExecOptions {
  input: string;
}

function spawnAsync(command: string, args: string[], options: SpawnOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = <T>(fn: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
    });

    let stdout = '';
    let stderr = '';
    let size = 0;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(reject, new Error(`${command} timed out after ${options.timeout}ms`));
    }, options.timeout);

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBuffer) {
        child.kill('SIGTERM');
        settle(reject, new Error(`${command} stdout exceeded maxBuffer (${options.maxBuffer})`));
        return;
      }
      stdout += chunk;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });

    child.on('close', (code) => {
      if (code !== 0) {
        settle(reject, new Error(`${command} exited with status ${code}: ${stderr}`));
      } else {
        settle(resolve, stdout);
      }
    });

    child.on('error', (err) => {
      settle(reject, err);
    });

    child.stdin.write(options.input);
    child.stdin.end();
  });
}
