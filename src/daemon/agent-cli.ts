import { execFile, spawn, spawnSync } from 'node:child_process';
// logic inspired from Roborev
export type AgentName = 'claude' | 'codex' | 'gemini' | 'copilot' | 'opencode' | 'cursor';

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

function buildClaudeEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('CLAUDECODE')) {
      env[key] = value;
    }
  }
  env.CLAUDE_NO_SOUND = '1';
  env.MESA_REVIEW_AGENT = '1';
  return env;
}

/**
 * Invokes the given agent CLI with a review prompt and returns the raw text output.
 * Async — does not block the Node.js event loop, allowing the HTTP server to stay responsive.
 *
 * - claude: uses -p with restricted tool access
 * - codex: uses stdin-based invocation with --full-auto
 * - others: generic -p fallback
 */
export async function invokeAgent(agent: AgentName, prompt: string, cwd: string, model?: string): Promise<string> {
  const command = AGENT_COMMANDS[agent];

  switch (agent) {
    case 'claude': {
      const args = [
        '-p',
        '-',
        '--verbose',
        '--output-format',
        'text',
        '--dangerously-skip-permissions',
        '--allowedTools',
        'Read,Glob,Grep',
      ];
      if (model) {
        args.push('--model', model);
      }
      return spawnAsync(command, args, {
        cwd,
        input: prompt,
        env: buildClaudeEnv(),
        encoding: 'utf8',
        maxBuffer: TEN_MB,
        timeout: FIVE_MINUTES_MS,
      });
    }

    case 'codex': {
      return spawnAsync(command, ['exec', '--json', '--full-auto', '-C', cwd], {
        cwd,
        input: prompt,
        env: { ...process.env },
        encoding: 'utf8',
        maxBuffer: TEN_MB,
        timeout: FIVE_MINUTES_MS,
      });
    }

    default: {
      return execFileAsync(command, ['-p', prompt], {
        cwd,
        env: { ...process.env },
        encoding: 'utf8',
        maxBuffer: TEN_MB,
        timeout: FIVE_MINUTES_MS,
      });
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
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
    });

    let stdout = '';
    let stderr = '';
    let size = 0;

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`${command} timed out after ${options.timeout}ms`));
    }, options.timeout);

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxBuffer) {
        child.kill('SIGTERM');
        reject(new Error(`${command} stdout exceeded maxBuffer (${options.maxBuffer})`));
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
        reject(new Error(`${command} exited with status ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.stdin.write(options.input);
    child.stdin.end();
  });
}
