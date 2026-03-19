import { spawn, spawnSync } from 'node:child_process';
import type { AgentRunner, AgentRunnerOptions, AgentRunnerResult } from '../core/types.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MB = 10 * 1024 * 1024;
const DEFAULT_MAX_TURNS = 30;

interface SpawnCliOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  input: string;
  timeout: number;
  abortSignal?: AbortSignal;
}

function spawnCliAgent(options: SpawnCliOptions): Promise<AgentRunnerResult> {
  return new Promise((resolve, reject) => {
    const startMs = Date.now();
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
    });

    let stdout = '';
    let stderr = '';
    let stdoutSize = 0;
    let settled = false;

    function settle(fn: () => void): void {
      if (!settled) {
        settled = true;
        fn();
      }
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new Error(`${options.command} timed out after ${options.timeout}ms`)));
    }, options.timeout);

    if (options.abortSignal) {
      if (options.abortSignal.aborted) {
        child.kill('SIGTERM');
        clearTimeout(timer);
        settle(() => reject(new Error('Aborted')));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        child.kill('SIGTERM');
        settle(() => reject(new Error('Aborted')));
      };
      options.abortSignal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutSize += chunk.length;
      if (stdoutSize > TEN_MB) {
        child.kill('SIGTERM');
        settle(() => {
          clearTimeout(timer);
          reject(new Error(`${options.command} stdout exceeded max buffer (${TEN_MB} bytes)`));
        });
        return;
      }
      stdout += chunk;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        settle(() => reject(new Error(`${options.command} exited with status ${code}: ${stderr}`)));
        return;
      }

      const durationMs = Date.now() - startMs;
      settle(() => resolve({ output: stdout, durationMs }));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(err));
    });

    child.stdin.write(options.input);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// CLI Detection
// ---------------------------------------------------------------------------

export function isCliAvailable(command: string): boolean {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
}

export function isCliAuthenticated(command: string): boolean {
  try {
    switch (command) {
      case 'claude': {
        const output = spawnSync('claude', ['auth', 'status', '--json'], {
          encoding: 'utf-8',
          timeout: 5_000,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        if (output.status !== 0) return false;
        const status = JSON.parse(output.stdout) as { loggedIn?: boolean };
        return status.loggedIn === true;
      }
      case 'codex': {
        const result = spawnSync('codex', ['login', 'status'], {
          timeout: 5_000,
          stdio: 'ignore',
        });
        return result.status === 0;
      }
      case 'gemini':
        // Gemini CLI has no auth status command — fall back to checking binary availability
        return isCliAvailable('gemini');
      default:
        return false;
    }
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Claude Code CLI
// ---------------------------------------------------------------------------

export function buildClaudeArgs(options: {
  systemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  maxTurns?: number;
  effort?: 'low' | 'medium' | 'high';
  outputFormat?: 'text' | 'json';
}): string[] {
  const args: string[] = [
    '-p',
    '-',
    '--dangerously-skip-permissions',
    '--output-format',
    options.outputFormat ?? 'text',
    '--verbose',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--setting-sources',
    '',
    '--max-turns',
    String(options.maxTurns ?? DEFAULT_MAX_TURNS),
    '--effort',
    options.effort ?? 'low',
  ];

  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--tools', options.allowedTools.join(','));
  }

  return args;
}

export function buildClaudeEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!key.startsWith('CLAUDECODE')) {
      env[key] = value;
    }
  }
  env.CLAUDE_NO_SOUND = '1';
  env.SAGUARO_REVIEW_AGENT = '1';
  return env;
}

export function createClaudeCliRunner(): AgentRunner {
  return {
    execute(options: AgentRunnerOptions): Promise<AgentRunnerResult> {
      const args = buildClaudeArgs({
        systemPrompt: options.systemPrompt,
        model: options.model,
        allowedTools: options.allowedTools,
        maxTurns: options.maxTurns,
      });
      return spawnCliAgent({
        command: 'claude',
        args,
        cwd: options.cwd,
        env: buildClaudeEnv(process.env),
        input: options.prompt,
        timeout: options.timeout ?? FIVE_MINUTES_MS,
        abortSignal: options.abortSignal,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Shared Prompt Helpers
// ---------------------------------------------------------------------------

const READ_ONLY_NOTICE =
  'IMPORTANT: You are running in READ-ONLY mode. Do NOT create, modify, or delete any files. Only read files and produce your review output.';

function combineStdinPrompt(systemPrompt: string, userPrompt: string): string {
  const system = systemPrompt ? `${systemPrompt}\n\n${READ_ONLY_NOTICE}` : READ_ONLY_NOTICE;
  return `${system}\n\n---\n\n${userPrompt}`;
}

// ---------------------------------------------------------------------------
// Codex CLI (OpenAI)
// ---------------------------------------------------------------------------

export function buildCodexArgs(options: {
  cwd: string;
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}): string[] {
  const args: string[] = ['exec', '--full-auto', '--color', 'never', '--ephemeral', '-C', options.cwd];

  if (options.model) {
    args.push('-m', options.model);
  }

  if (options.reasoningEffort) {
    args.push('--config', `model_reasoning_effort=${options.reasoningEffort}`);
  }

  args.push('-');
  return args;
}

export function buildCodexEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...baseEnv, SAGUARO_REVIEW_AGENT: '1' };
}

export function createCodexCliRunner(): AgentRunner {
  return {
    execute(options: AgentRunnerOptions): Promise<AgentRunnerResult> {
      const input = combineStdinPrompt(options.systemPrompt, options.prompt);

      const args = buildCodexArgs({ cwd: options.cwd, model: options.model });
      return spawnCliAgent({
        command: 'codex',
        args,
        cwd: options.cwd,
        env: buildCodexEnv(process.env),
        input,
        timeout: options.timeout ?? FIVE_MINUTES_MS,
        abortSignal: options.abortSignal,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Gemini CLI (Google)
// ---------------------------------------------------------------------------

export function buildGeminiArgs(options: { model?: string }): string[] {
  const args: string[] = ['--approval-mode', 'yolo'];

  if (options.model) {
    args.push('-m', options.model);
  }

  return args;
}

export function buildGeminiEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...baseEnv, SAGUARO_REVIEW_AGENT: '1' };
}

export function createGeminiCliRunner(): AgentRunner {
  return {
    execute(options: AgentRunnerOptions): Promise<AgentRunnerResult> {
      const input = combineStdinPrompt(options.systemPrompt, options.prompt);

      const args = buildGeminiArgs({ model: options.model });
      return spawnCliAgent({
        command: 'gemini',
        args,
        cwd: options.cwd,
        env: buildGeminiEnv(process.env),
        input,
        timeout: options.timeout ?? FIVE_MINUTES_MS,
        abortSignal: options.abortSignal,
      });
    },
  };
}
