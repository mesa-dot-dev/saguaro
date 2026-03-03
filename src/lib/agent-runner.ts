import { spawn } from 'node:child_process';

export interface AgentRunnerResult {
  output: string;
  durationMs: number;
}

export interface AgentRunnerOptions {
  systemPrompt: string;
  prompt: string;
  cwd: string;
  allowedTools?: string[];
  model?: string;
  maxTurns?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
}

export interface AgentRunner {
  execute(options: AgentRunnerOptions): Promise<AgentRunnerResult>;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MB = 10 * 1024 * 1024;
const DEFAULT_MAX_TURNS = 10;

export function buildClaudeArgs(options: {
  systemPrompt?: string;
  model?: string;
  allowedTools?: string[];
  maxTurns?: number;
}): string[] {
  const args: string[] = [
    '-p',
    '-',
    '--dangerously-skip-permissions',
    '--output-format',
    'text',
    '--verbose',
    '--no-session-persistence',
    '--disable-slash-commands',
    '--setting-sources',
    '',
    '--max-turns',
    String(options.maxTurns ?? DEFAULT_MAX_TURNS),
    '--effort',
    'medium',
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
  env.MESA_REVIEW_AGENT = '1';
  return env;
}

export function createClaudeCliRunner(): AgentRunner {
  return {
    execute(options: AgentRunnerOptions): Promise<AgentRunnerResult> {
      return spawnClaude(options);
    },
  };
}

function spawnClaude(options: AgentRunnerOptions): Promise<AgentRunnerResult> {
  const timeout = options.timeout ?? FIVE_MINUTES_MS;
  const args = buildClaudeArgs({
    systemPrompt: options.systemPrompt,
    model: options.model,
    allowedTools: options.allowedTools,
    maxTurns: options.maxTurns,
  });
  const env = buildClaudeEnv(process.env);

  return new Promise((resolve, reject) => {
    const startMs = Date.now();
    const child = spawn('claude', args, { cwd: options.cwd, env });

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
      settle(() => reject(new Error(`claude timed out after ${timeout}ms`)));
    }, timeout);

    // Support external abort
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
          reject(new Error(`claude stdout exceeded max buffer (${TEN_MB} bytes)`));
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
        settle(() => reject(new Error(`claude exited with status ${code}: ${stderr}`)));
        return;
      }

      const durationMs = Date.now() - startMs;
      settle(() => resolve({ output: stdout, durationMs }));
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      settle(() => reject(err));
    });

    child.stdin.write(options.prompt);
    child.stdin.end();
  });
}
