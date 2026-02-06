import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Config as OpencodeConfig } from '@opencode-ai/sdk';
import { createOpencodeClient } from '@opencode-ai/sdk';
import chalk from 'chalk';
import yaml from 'js-yaml';
import type { ReviewResult, Rule, Violation } from '../types/types.js';

export interface RunReviewOptions {
  baseBranch: string;
  filesWithRules: Map<string, Rule[]>;
  configPath?: string;
  verbose?: boolean;
}

interface MesaConfig {
  model?: {
    provider?: string;
    name?: string;
  };
  api_keys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
  };
  opencode?: {
    url?: string;
  };
  review?: {
    files_per_worker?: number;
  };
}

const DEFAULT_FILES_PER_WORKER = 15;
const REVIEW_TIMEOUT_MS = 180_000;

function createProcessingSpinner(enabled: boolean, initialMessage: string) {
  const frames = ['-', '\\', '|', '/'];
  let frameIndex = 0;
  let message = initialMessage;
  let timer: NodeJS.Timeout | null = null;

  const render = () => {
    if (!enabled) return;
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${frames[frameIndex]} ${message}`);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  const start = () => {
    if (!enabled || timer) return;
    render();
    timer = setInterval(render, 120);
  };

  const stop = () => {
    if (!enabled) return;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };

  const setMessage = (nextMessage: string) => {
    message = nextMessage;
  };

  const log = (line: string) => {
    stop();
    console.log(line);
    start();
  };

  const error = (line: string) => {
    stop();
    console.error(line);
    start();
  };

  return {
    start,
    stop,
    setMessage,
    log,
    error,
  };
}

export async function runReviewAgent(options: RunReviewOptions): Promise<ReviewResult> {
  const mesaConfig = loadMesaConfig(options.configPath);
  validateConfig(mesaConfig);
  const apiKey = resolveApiKey(mesaConfig);
  const opencodeConfig = loadOpencodeConfig(mesaConfig);
  const opencodeUrl = mesaConfig.opencode?.url || process.env.OPENCODE_URL || null;

  let proc: ChildProcess | null = null;
  let tempDir: string | null = null;

  try {
    let baseUrl: string;

    if (opencodeUrl) {
      baseUrl = opencodeUrl;
    } else {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-review-'));
      const result = await startIsolatedServer({ opencodeConfig, tempDir, verbose: options.verbose });
      proc = result.proc;
      baseUrl = result.url;
    }

    const client = createOpencodeClient({ baseUrl });

    await waitForHealthy(client, options.verbose);

    const provider = mesaConfig.model?.provider ?? 'anthropic';
    await client.auth.set({
      path: { id: provider },
      body: { type: 'api', key: apiKey },
    });

    if (options.verbose) {
      console.log(chalk.gray(`Auth set for provider: ${provider}`));
    }

    const { filesPerWorker, source } = resolveFilesPerWorker(mesaConfig);
    const fileGroups = splitFilesForWorkers(options.filesWithRules, filesPerWorker);

    if (options.verbose) {
      console.log(chalk.gray(`Split ${options.filesWithRules.size} files into ${fileGroups.length} worker group(s)`));
      if (source === 'env') {
        console.log(chalk.gray(`Using files per worker override from MESA_FILES_PER_WORKER=${filesPerWorker}`));
      } else if (source === 'config') {
        console.log(
          chalk.gray(`Using files per worker from .mesa/config.yaml review.files_per_worker=${filesPerWorker}`)
        );
      }
    }

    const sessionIds: string[] = [];
    const sessionPrompts: string[] = [];

    for (let i = 0; i < fileGroups.length; i++) {
      const sessionOptions = { ...options, filesWithRules: fileGroups[i] };
      const prompt = buildPrompt(sessionOptions);
      sessionPrompts.push(prompt);

      const sessionRes = await client.session.create({
        body: { title: `Review worker ${i + 1}/${fileGroups.length}` },
      });
      if (!sessionRes.data) {
        throw new Error(`Failed to create session ${i + 1}: ${JSON.stringify(sessionRes.error)}`);
      }
      sessionIds.push(sessionRes.data.id);
    }

    if (options.verbose) {
      console.log(
        chalk.gray(`Created ${sessionIds.length} worker(s) (OpenCode session IDs): ${sessionIds.join(', ')}`)
      );
    }

    try {
      const sessionResults = await streamParallelReviews(client, sessionIds, sessionPrompts, options.verbose);
      const allViolations = sessionResults.flatMap((text) => parseViolations(text, options.filesWithRules));

      return {
        violations: allViolations,
        summary: {
          filesReviewed: options.filesWithRules.size,
          rulesChecked: countRules(options.filesWithRules),
          errors: allViolations.filter((v) => v.severity === 'error').length,
          warnings: allViolations.filter((v) => v.severity === 'warning').length,
          infos: allViolations.filter((v) => v.severity === 'info').length,
        },
      };
    } finally {
      await Promise.all(sessionIds.map((id) => client.session.delete({ path: { id } }).catch(() => {})));
    }
  } finally {
    if (proc) {
      await terminateProcess(proc, options.verbose);
    }
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch (error) {
        if (options.verbose) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(chalk.yellow(`Failed to remove temp dir ${tempDir}: ${message}`));
        }
      }
    }
  }
}

function splitFilesForWorkers(filesWithRules: Map<string, Rule[]>, filesPerWorker: number): Map<string, Rule[]>[] {
  const entries = Array.from(filesWithRules.entries());
  const groups: Map<string, Rule[]>[] = [];
  for (let i = 0; i < entries.length; i += filesPerWorker) {
    groups.push(new Map(entries.slice(i, i + filesPerWorker)));
  }
  return groups;
}

function resolveFilesPerWorker(config: MesaConfig): {
  filesPerWorker: number;
  source: 'default' | 'config' | 'env';
} {
  const rawEnv = process.env.MESA_FILES_PER_WORKER;
  if (rawEnv) {
    const parsed = Number.parseInt(rawEnv, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return { filesPerWorker: parsed, source: 'env' };
    }
  }

  const fromConfig = config.review?.files_per_worker;
  if (Number.isFinite(fromConfig) && fromConfig !== undefined && fromConfig >= 1) {
    return { filesPerWorker: Math.floor(fromConfig), source: 'config' };
  }

  return { filesPerWorker: DEFAULT_FILES_PER_WORKER, source: 'default' };
}

async function streamParallelReviews(
  client: ReturnType<typeof createOpencodeClient>,
  sessionIds: string[],
  prompts: string[],
  verbose?: boolean
): Promise<string[]> {
  const events = await client.event.subscribe({ parseAs: 'stream' });
  const spinner = createProcessingSpinner(
    process.stdout.isTTY,
    `Processing review... 0/${sessionIds.length} worker(s) complete`
  );

  const sessionSet = new Set(sessionIds);
  const texts: Record<string, string> = {};
  const completed = new Set<string>();
  const errors: Record<string, string> = {};
  let viewDiffFailureCount = 0;

  for (const id of sessionIds) {
    texts[id] = '';
  }

  for (let i = 0; i < sessionIds.length; i++) {
    const promptRes = await client.session.promptAsync({
      path: { id: sessionIds[i] },
      body: {
        agent: 'code-reviewer',
        parts: [{ type: 'text', text: prompts[i] }],
      },
    });

    if (promptRes.error) {
      throw new Error(`Prompt failed for session ${i + 1}: ${JSON.stringify(promptRes.error)}`);
    }

    if (verbose) {
      console.log(chalk.gray(`Worker ${i + 1}/${sessionIds.length} sent (${prompts[i].length} chars)`));
    }
  }

  const abortController = new AbortController();
  let timedOut = false;
  const deadlineTimer = setTimeout(() => {
    timedOut = true;
    spinner.log(chalk.yellow(`Timeout: ${completed.size}/${sessionIds.length} worker(s) completed`));
    abortController.abort();
  }, REVIEW_TIMEOUT_MS);

  spinner.start();

  try {
    for await (const event of events.stream) {
      if (abortController.signal.aborted) break;
      if (completed.size === sessionIds.length) break;

      // Stream text and tool call output
      if (event.type === 'message.part.updated') {
        const props = event.properties as any;
        const part = props?.part;
        if (!part || !sessionSet.has(part.sessionID)) continue;

        if (part.type === 'text') {
          const delta = props.delta;
          if (delta) {
            texts[part.sessionID] = (texts[part.sessionID] ?? '') + delta;
          } else {
            const newText = part.text ?? '';
            texts[part.sessionID] = newText;
          }
        }

        if (part.type === 'tool' && part.state?.status === 'completed') {
          const sessionIndex = sessionIds.indexOf(part.sessionID) + 1;
          const label = part.state.input?.filepath || part.state.title || 'done';
          const toolOutput = typeof part.state.output === 'string' ? part.state.output : '';
          if (part.tool === 'view_diff' && toolOutput.startsWith('[VIEW_DIFF_ERROR]')) {
            viewDiffFailureCount++;
            if (verbose) {
              spinner.log(chalk.red(`  [${sessionIndex}] ↳ ${part.tool} failed for ${label}: ${toolOutput}`));
            }
          }
          if (verbose) {
            spinner.log(chalk.cyan(`  [${sessionIndex}] ↳ ${part.tool}: ${label}`));
          }
        }
      }

      // Completion detection — matches OpenCode CLI's own approach (run.ts:490-496)
      if (event.type === 'session.status') {
        const props = event.properties;
        if (sessionSet.has(props.sessionID) && props.status.type === 'idle') {
          if (!completed.has(props.sessionID)) {
            completed.add(props.sessionID);
            const sessionIndex = sessionIds.indexOf(props.sessionID) + 1;
            spinner.setMessage(`Processing review... ${completed.size}/${sessionIds.length} worker(s) complete`);
            spinner.log(chalk.green(`✓ Worker ${sessionIndex}/${sessionIds.length} complete`));
          }
        }
      }

      if (event.type === 'session.error') {
        const props = event.properties;
        const errorSessionID = props.sessionID;
        if (errorSessionID && sessionSet.has(errorSessionID) && props.error) {
          const err = props.error as any;
          const errMsg = err?.data?.message || err?.name || 'Unknown error';
          errors[errorSessionID] = errMsg;
          const sessionIndex = sessionIds.indexOf(errorSessionID) + 1;
          spinner.log(chalk.red(`✗ Worker ${sessionIndex} error: ${errMsg}`));
          completed.add(errorSessionID);
          spinner.setMessage(`Processing review... ${completed.size}/${sessionIds.length} worker(s) complete`);
        }
      }

      if (event.type === 'permission.updated') {
        const props = event.properties;
        if (sessionSet.has(props.sessionID)) {
          if (verbose) {
            const patterns = Array.isArray(props.pattern) ? props.pattern.join(', ') : (props.pattern ?? '*');
            spinner.log(chalk.yellow(`  Auto-rejecting permission: ${props.type} (${patterns})`));
          }
          try {
            await client.postSessionIdPermissionsPermissionId({
              path: { id: props.sessionID, permissionID: props.id },
              body: { response: 'reject' },
            });
          } catch (error) {
            const sessionIndex = sessionIds.indexOf(props.sessionID) + 1;
            const message = error instanceof Error ? error.message : String(error);
            spinner.error(chalk.red(`Failed to auto-reject permission for worker ${sessionIndex}: ${message}`));
          }
        }
      }
    }
  } finally {
    clearTimeout(deadlineTimer);
    spinner.stop();
  }

  if (timedOut) {
    const outstandingCount = sessionIds.length - completed.size;
    if (outstandingCount > 0) {
      console.log(chalk.yellow(`Marked ${outstandingCount} worker(s) incomplete due to timeout`));
    }
  }

  for (const id of sessionIds) {
    if (texts[id]) continue;
    const messagesRes = await client.session.messages({ path: { id } });
    const messages = messagesRes.data as any[];
    const lastAssistant = messages?.filter((m: any) => m.role === 'assistant' || m.info?.role === 'assistant').pop();
    if (lastAssistant) {
      const parts = lastAssistant.parts ?? lastAssistant.info?.parts;
      texts[id] =
        parts
          ?.filter((p: any) => p.type === 'text')
          .map((p: any) => p.text)
          .join('\n') ?? '';
    }
  }

  const errorEntries = Object.entries(errors);
  if (errorEntries.length > 0) {
    for (const [id, err] of errorEntries) {
      const sessionIndex = sessionIds.indexOf(id) + 1;
      console.error(chalk.red(`Worker ${sessionIndex} failed: ${err}`));
    }
  }

  if (!verbose && viewDiffFailureCount > 0) {
    console.log(chalk.yellow(`view_diff failed ${viewDiffFailureCount} time(s); rerun with --verbose for details`));
  }

  return sessionIds.map((id) => texts[id] ?? '');
}

interface IsolatedServerResult {
  proc: ChildProcess;
  url: string;
}

const MAX_PORT_RETRIES = 3;

async function startIsolatedServer({
  opencodeConfig,
  tempDir,
  verbose,
}: {
  opencodeConfig: OpencodeConfig;
  tempDir: string;
  verbose?: boolean;
}): Promise<IsolatedServerResult> {
  fs.mkdirSync(path.join(tempDir, 'opencode'), { recursive: true });
  writeCustomTools(tempDir);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
    const port = 19456 + Math.floor(Math.random() * 1000);
    const hostname = '127.0.0.1';
    const args = ['serve', `--hostname=${hostname}`, `--port=${port}`];
    if (verbose) {
      args.push('--print-logs', '--log-level=WARN');
    }

    try {
      const result = await tryStartServer({ args, tempDir, opencodeConfig, verbose });
      return result;
    } catch (err: any) {
      lastError = err;
      if (verbose) {
        console.log(chalk.gray(`Port ${port} unavailable, trying next...`));
      }
    }
  }

  throw lastError ?? new Error('Failed to start OpenCode server');
}

function tryStartServer({
  args,
  tempDir,
  opencodeConfig,
  verbose,
}: {
  args: string[];
  tempDir: string;
  opencodeConfig: OpencodeConfig;
  verbose?: boolean;
}): Promise<IsolatedServerResult> {
  const proc = spawn('opencode', args, {
    cwd: process.cwd(),
    env: {
      HOME: tempDir,
      PATH: process.env.PATH,
      XDG_CONFIG_HOME: tempDir,
      XDG_DATA_HOME: tempDir,
      OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
      OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCODE_DISABLE_AUTOCOMPACT: 'true',
    },
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout waiting for OpenCode server to start (10s)'));
    }, 10_000);

    let output = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const lines = output.split('\n');
      for (const line of lines) {
        if (line.startsWith('opencode server listening')) {
          const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
          if (!match) {
            clearTimeout(timeout);
            proc.kill();
            reject(new Error(`Failed to parse server url from: ${line}`));
            return;
          }
          clearTimeout(timeout);
          if (verbose) {
            console.log(chalk.gray(`OpenCode server started on ${match[1]}`));
          }
          resolve({ proc, url: match[1] });
          return;
        }
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`OpenCode server exited with code ${code}\n${output}`));
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function writeCustomTools(tempDir: string): void {
  const toolsDir = path.join(tempDir, '.opencode', 'tools');
  fs.mkdirSync(toolsDir, { recursive: true });

  const viewDiffTool = `
import { z } from "zod"
import { execSync } from "child_process"

export default {
  description: "View the git diff for a specific file between a base branch and HEAD. Returns only the diff output. If the file has no changes, returns 'No changes.'",
  args: {
    filepath: z.string().describe("The file path to diff"),
    base: z.string().describe("The base branch to diff against"),
  },
  async execute(args, ctx) {
    try {
      const output = execSync(
        \`git diff \${args.base}...HEAD -- \${args.filepath}\`,
        { encoding: "utf8", cwd: ctx.directory, maxBuffer: 1024 * 1024 }
      )
      if (!output.trim()) return "No changes."
      return output
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return \`[VIEW_DIFF_ERROR] \${message}\`
    }
  },
}
`;

  fs.writeFileSync(path.join(toolsDir, 'view_diff.ts'), viewDiffTool.trim());
}

async function waitForHealthy(client: ReturnType<typeof createOpencodeClient>, verbose?: boolean): Promise<void> {
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { data, error } = await client.app.agents();
      if (data && !error) {
        if (verbose) {
          console.log(chalk.gray('OpenCode server healthy'));
        }
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('OpenCode server failed health check after 5s');
}

async function terminateProcess(proc: ChildProcess, verbose?: boolean): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) {
    return;
  }

  const stopWith = (signal: NodeJS.Signals, timeoutMs: number) =>
    new Promise<boolean>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve(true);
        return;
      }

      proc.kill(signal);

      const timer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      const onExit = () => {
        cleanup();
        resolve(true);
      };

      const cleanup = () => {
        clearTimeout(timer);
        proc.off('exit', onExit);
      };

      proc.on('exit', onExit);
    });

  if (await stopWith('SIGTERM', 3000)) {
    return;
  }

  if (verbose) {
    console.log(chalk.yellow('OpenCode server did not exit after SIGTERM, sending SIGKILL'));
  }

  if (!(await stopWith('SIGKILL', 2000)) && verbose) {
    console.log(chalk.yellow('OpenCode server process did not confirm exit after SIGKILL'));
  }
}

function loadMesaConfig(configPath?: string): MesaConfig {
  const resolvedPath = resolveMesaConfigPath(configPath);
  if (!resolvedPath) {
    throw new Error('Mesa config not found. Run "mesa init" or pass --config.');
  }

  const contents = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = yaml.load(contents);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid Mesa config at ${resolvedPath}`);
  }
  return parsed as MesaConfig;
}

const VALID_PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter'];

function validateConfig(config: MesaConfig): void {
  const provider = config.model?.provider;
  const name = config.model?.name;

  if (!provider || !name) {
    throw new Error(
      'Invalid config: model.provider and model.name are required.\n' +
        '  Edit .mesa/config.yaml to set your model configuration.'
    );
  }

  if (!VALID_PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid config: model.provider "${provider}" is not valid.\n` +
        `  Valid providers: ${VALID_PROVIDERS.join(', ')}\n` +
        '  Edit .mesa/config.yaml to fix this.'
    );
  }

  if (name === 'MODEL_NAME' || provider === 'PROVIDER') {
    throw new Error(
      'Invalid config: placeholder values detected.\n' +
        '  Edit .mesa/config.yaml and replace MODEL_NAME/PROVIDER with real values.\n' +
        '  Example: provider: anthropic, name: claude-sonnet-4-5'
    );
  }
}

function resolveMesaConfigPath(configPath?: string): string | null {
  if (configPath && fs.existsSync(configPath)) return configPath;

  const envPath = process.env.MESA_CONFIG;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const defaultPath = path.resolve(process.cwd(), '.mesa', 'config.yaml');
  if (fs.existsSync(defaultPath)) return defaultPath;

  return null;
}

function resolveApiKey(config: MesaConfig): string {
  const provider = config.model?.provider ?? 'anthropic';

  const envKeys: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };

  const envKey = envKeys[provider];
  if (envKey) return envKey;

  const configKeys = config.api_keys ?? {};
  const configKey = configKeys[provider as keyof typeof configKeys];
  if (configKey) return configKey;

  throw new Error(
    `No API key found for provider "${provider}". Set one via:\n` +
      `  1. export ${provider.toUpperCase()}_API_KEY=<key>\n` +
      '  2. Set api_keys in .mesa/config.yaml'
  );
}

function loadOpencodeConfig(mesaConfig: MesaConfig): OpencodeConfig {
  const opencodeConfigPath = resolveOpencodeConfigPath();
  const baseConfig = JSON.parse(fs.readFileSync(opencodeConfigPath, 'utf8')) as OpencodeConfig;

  // Override model from Mesa config
  const model = resolveModel(mesaConfig);
  if (model) {
    baseConfig.model = model;
    const agentConfig = baseConfig.agent?.['code-reviewer'];
    if (agentConfig) {
      agentConfig.model = model;
    }
  }
  // Mesa config should not be updated automatically by opencode
  baseConfig.autoupdate = false;
  baseConfig.share = 'disabled';
  if (!baseConfig.disabled_providers) {
    baseConfig.disabled_providers = [];
  }

  return baseConfig;
}

function resolveOpencodeConfigPath(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = path.resolve(currentDir, '..', '..', 'opencode.json');
  if (!fs.existsSync(candidate)) {
    throw new Error(`OpenCode config not found at ${candidate}`);
  }
  return candidate;
}

function resolveModel(config: MesaConfig): string | null {
  const provider = config.model?.provider;
  const name = config.model?.name;
  if (!provider || !name) return null;
  return `${provider}/${name}`;
}

function buildPrompt(options: RunReviewOptions): string {
  const lines: string[] = [];

  lines.push(`Base branch: ${options.baseBranch}`);
  lines.push('');
  lines.push('For each file below, call view_diff with the filepath and base="' + options.baseBranch + '".');
  lines.push('Then check ONLY the added lines ("+") against the listed rules.');
  lines.push('');

  for (const [file, rules] of options.filesWithRules) {
    lines.push(`${file}`);
    for (const rule of rules) {
      lines.push(`  → ${rule.id} (${rule.severity})`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');

  const uniqueRules = new Set<Rule>(Array.from(options.filesWithRules.values()).flat());
  for (const rule of uniqueRules) {
    lines.push(formatRule(rule));
    lines.push('');
  }

  return lines.join('\n');
}

function formatRule(rule: Rule): string {
  const lines: string[] = [
    `### Rule ID: ${rule.id}`,
    `**Severity:** ${rule.severity}`,
    `**Applies to:** ${rule.globs.join(', ')}`,
    '',
    rule.instructions,
  ];

  if (rule.examples) {
    lines.push('');
    if (rule.examples.violations?.length) {
      lines.push(`**Violations:** ${rule.examples.violations.join(', ')}`);
    }
    if (rule.examples.compliant?.length) {
      lines.push(`**Compliant:** ${rule.examples.compliant.join(', ')}`);
    }
  }

  return lines.join('\n');
}

function parseViolations(text: string, filesWithRules: Map<string, Rule[]>): Violation[] {
  const violations: Violation[] = [];
  if (!text) return violations;

  if (text.toLowerCase().includes('no violations found')) {
    return violations;
  }

  const rulesById = new Map<string, Rule>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      if (!rulesById.has(rule.id)) {
        rulesById.set(rule.id, rule);
      }
    }
  }

  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/\[([^\]]+)\]\s+(\S+):(\d+)?\s*-\s*(.+)/);
    if (match) {
      const ruleId = match[1];
      const rule = rulesById.get(ruleId);
      violations.push({
        ruleId,
        ruleTitle: rule?.title ?? ruleId,
        severity: rule?.severity ?? 'error',
        file: match[2],
        line: match[3] ? parseInt(match[3]) : undefined,
        message: match[4],
      });
    }
  }

  return violations;
}

function countRules(filesWithRules: Map<string, Rule[]>): number {
  const uniqueRules = new Set<string>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      uniqueRules.add(rule.id);
    }
  }
  return uniqueRules.size;
}
