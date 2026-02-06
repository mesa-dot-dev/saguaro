import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config as OpencodeConfig } from '@opencode-ai/sdk';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import chalk from 'chalk';
import type { ReviewResult, Rule, Violation } from '../types/types.js';
import { loadMesaConfig, loadOpencodeConfig, resolveApiKey, validateConfig } from './config.js';
import { parseViolationsDetailed } from './parse.js';
import { buildPrompt } from './prompt.js';
import { createProcessingSpinner } from './spinner.js';
import { VIEW_DIFF_TOOL_TEMPLATE } from './view-diff-tool-template.js';

export interface RunReviewOptions {
  baseBranch: string;
  filesWithRules: Map<string, Rule[]>;
  configPath?: string;
  verbose?: boolean;
}

const FILES_PER_WORKER = 3;
const REVIEW_TIMEOUT_MS = 600_000;

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
      providerID: provider,
      auth: { type: 'api', key: apiKey },
    });

    if (options.verbose) {
      console.log(chalk.gray(`Auth set for provider: ${provider}`));
    }

    const fileGroups = splitFilesForWorkers(options.filesWithRules);

    if (options.verbose) {
      console.log(chalk.gray(`Split ${options.filesWithRules.size} files into ${fileGroups.length} worker group(s)`));
    }

    const sessionIds: string[] = [];
    const sessionPrompts: string[] = [];

    for (let i = 0; i < fileGroups.length; i++) {
      const sessionOptions = { ...options, filesWithRules: fileGroups[i] };
      const prompt = buildPrompt(sessionOptions);
      sessionPrompts.push(prompt);

      const sessionRes = await client.session.create({
        title: `Review worker ${i + 1}/${fileGroups.length}`,
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
      const parseResults = sessionResults.map((text) => parseViolationsDetailed(text, options.filesWithRules));
      const allViolations = parseResults.flatMap((result) => result.violations);

      if (options.verbose) {
        for (let i = 0; i < parseResults.length; i++) {
          const result = parseResults[i];
          const workerIndex = i + 1;
          console.log(
            chalk.gray(
              `Parse worker ${workerIndex}/${parseResults.length}: matched=${result.matchedLines}, ignored=${result.ignoredLines}, violations=${result.violations.length}`
            )
          );

          if (result.shortCircuitedNoViolations) {
            console.log(chalk.yellow(`  Worker ${workerIndex} parser short-circuited on "no violations found" text`));
          } else if (result.totalLines > 0 && result.matchedLines === 0) {
            console.log(chalk.yellow(`  Worker ${workerIndex} returned text but no lines matched violation format`));
          }
        }
      }

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
      const cleanupErrors: string[] = [];
      await Promise.all(
        sessionIds.map(async (id) => {
          try {
            await client.session.delete({ sessionID: id });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            cleanupErrors.push(`Failed to delete session ${id}: ${message}`);
          }
        })
      );
      if (cleanupErrors.length > 0 && options.verbose) {
        for (const message of cleanupErrors) {
          console.log(chalk.yellow(message));
        }
      }
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

function splitFilesForWorkers(filesWithRules: Map<string, Rule[]>): Map<string, Rule[]>[] {
  const entries = Array.from(filesWithRules.entries());
  const groups: Map<string, Rule[]>[] = [];
  for (let i = 0; i < entries.length; i += FILES_PER_WORKER) {
    groups.push(new Map(entries.slice(i, i + FILES_PER_WORKER)));
  }
  return groups;
}

async function streamParallelReviews(
  client: ReturnType<typeof createOpencodeClient>,
  sessionIds: string[],
  prompts: string[],
  verbose?: boolean
): Promise<string[]> {
  const events = await client.event.subscribe();
  const spinner = createProcessingSpinner(
    process.stdout.isTTY,
    `Processing review... 0/${sessionIds.length} worker(s) complete`
  );

  const sessionSet = new Set(sessionIds);
  const texts: Record<string, string> = Object.fromEntries(sessionIds.map((id) => [id, '']));
  const completed = new Set<string>();
  const errors: Record<string, string> = {};
  let viewDiffFailureCount = 0;

  for (let i = 0; i < sessionIds.length; i++) {
    const promptRes = await client.session.promptAsync({
      sessionID: sessionIds[i],
      agent: 'code-reviewer',
      parts: [{ type: 'text', text: prompts[i] }],
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

      switch (event.type) {
        case 'message.part.updated': {
          const part = event.properties.part;
          if (!sessionSet.has(part.sessionID)) continue;
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
          break;
        }
        case 'session.status': {
          const props = event.properties;
          if (!sessionSet.has(props.sessionID) || props.status.type !== 'idle') {
            break;
          }
          if (!completed.has(props.sessionID)) {
            completed.add(props.sessionID);
            const sessionIndex = sessionIds.indexOf(props.sessionID) + 1;
            spinner.setMessage(`Processing review... ${completed.size}/${sessionIds.length} worker(s) complete`);
            spinner.log(chalk.green(`✓ Worker ${sessionIndex}/${sessionIds.length} complete`));
          }
          break;
        }
        case 'session.error': {
          const props = event.properties;
          const errorSessionID = props.sessionID;
          if (!errorSessionID || !sessionSet.has(errorSessionID) || !props.error) {
            break;
          }
          const errorValue = props.error as { data?: { message?: string }; name?: string };
          const errMsg = errorValue.data?.message || errorValue.name || 'Unknown error';
          errors[errorSessionID] = errMsg;
          const sessionIndex = sessionIds.indexOf(errorSessionID) + 1;
          spinner.log(chalk.red(`✗ Worker ${sessionIndex} error: ${errMsg}`));
          completed.add(errorSessionID);
          spinner.setMessage(`Processing review... ${completed.size}/${sessionIds.length} worker(s) complete`);
          break;
        }
        case 'permission.asked': {
          const props = event.properties;
          if (!sessionSet.has(props.sessionID)) {
            break;
          }
          if (verbose) {
            spinner.log(
              chalk.yellow(`  Auto-rejecting permission: ${props.permission} (${props.patterns.join(', ')})`)
            );
          }
          try {
            await client.permission.reply({
              requestID: props.id,
              reply: 'reject',
            });
          } catch (error) {
            const sessionIndex = sessionIds.indexOf(props.sessionID) + 1;
            const message = error instanceof Error ? error.message : String(error);
            spinner.error(chalk.red(`Failed to auto-reject permission for worker ${sessionIndex}: ${message}`));
          }
          break;
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
    const messagesRes = await client.session.messages({ sessionID: id });
    const messages = Array.isArray(messagesRes.data) ? messagesRes.data : [];
    let text = '';

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i] as {
        role?: string;
        info?: { role?: string; parts?: Array<{ type?: string; text?: string }> };
        parts?: Array<{ type?: string; text?: string }>;
      };
      if (message.role !== 'assistant' && message.info?.role !== 'assistant') {
        continue;
      }

      const parts = message.parts ?? message.info?.parts ?? [];
      text = parts
        .filter((part) => part.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text as string)
        .join('\n');

      if (text) {
        break;
      }
    }

    texts[id] = text;
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
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
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
  fs.writeFileSync(path.join(toolsDir, 'view_diff.ts'), VIEW_DIFF_TOOL_TEMPLATE.trim());
}

async function waitForHealthy(client: ReturnType<typeof createOpencodeClient>, verbose?: boolean): Promise<void> {
  const maxAttempts = 10;
  let lastError: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const { data, error } = await client.app.agents();
      if (data && !error) {
        if (verbose) {
          console.log(chalk.gray('OpenCode server healthy'));
        }
        return;
      }
      if (error) {
        lastError = error;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (lastError) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`OpenCode server failed health check after 5s: ${message}`);
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

function countRules(filesWithRules: Map<string, Rule[]>): number {
  const uniqueRules = new Set<string>();
  for (const rules of filesWithRules.values()) {
    for (const rule of rules) {
      uniqueRules.add(rule.id);
    }
  }
  return uniqueRules.size;
}
