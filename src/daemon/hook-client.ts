import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { findRepoRoot } from '../lib/rule-resolution.js';
import { MesaDaemon } from './server.js';
import type { Finding, QueueJobInput } from './store.js';

export interface CheckResult {
  status: 'clear' | 'findings';
  pending?: boolean;
  findings?: Array<{
    id: number;
    findings: Finding[];
  }>;
}

function httpRequest(
  options: http.RequestOptions,
  body?: string,
  timeoutMs = 5000
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: data });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDaemonRunning(): Promise<{ port: number } | null> {
  const pidFile = MesaDaemon.readPidFile();
  if (pidFile) {
    return { port: pidFile.port };
  }

  let command: string;
  let args: string[];
  try {
    execFileSync('which', ['mesa'], { stdio: 'ignore' });
    command = 'mesa';
    args = ['daemon', 'start'];
  } catch {
    const distBin = path.resolve(findRepoRoot(), 'packages', 'code-review', 'dist', 'cli', 'bin', 'index.js');
    command = 'node';
    args = [distBin, 'daemon', 'start'];
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const pollInterval = 200;
  const maxWait = 6000;
  let waited = 0;

  while (waited < maxWait) {
    await sleep(pollInterval);
    waited += pollInterval;

    const pf = MesaDaemon.readPidFile();
    if (pf) {
      return { port: pf.port };
    }
  }

  return null;
}

export async function postReviewToDaemon(payload: QueueJobInput): Promise<boolean> {
  const daemon = await ensureDaemonRunning();
  if (!daemon) return false;

  try {
    const jsonBody = JSON.stringify(payload);
    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port: daemon.port,
        path: '/review',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(jsonBody),
        },
      },
      jsonBody,
      5000
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

export async function checkDaemonForViolations(sessionId: string): Promise<CheckResult> {
  return checkDaemon(sessionId);
}

/**
 * Poll the daemon for findings, waiting briefly if reviews are still pending.
 * This gives the background review time to finish before the stop hook gives up.
 *
 * The claude CLI typically takes 30-120s. We poll for up to 30s (within the
 * stop hook's 120s timeout) and return the last known state on timeout rather
 * than fabricating a `clear` result that would hide pending reviews.
 */
export async function checkDaemonWithPolling(
  sessionId: string,
  maxWaitMs = 30000,
  pollIntervalMs = 3000
): Promise<CheckResult> {
  const first = await checkDaemon(sessionId);

  // If we already have findings or nothing is pending, return immediately.
  if (first.status === 'findings' || !first.pending) {
    return first;
  }

  // Reviews are pending but not done yet — poll briefly.
  let lastResult = first;
  let waited = 0;
  while (waited < maxWaitMs) {
    await sleep(pollIntervalMs);
    waited += pollIntervalMs;

    const result = await checkDaemon(sessionId);
    lastResult = result;
    if (result.status === 'findings' || !result.pending) {
      return result;
    }
  }

  // Return actual last state so callers know reviews are still pending.
  return lastResult;
}

async function checkDaemon(sessionId: string): Promise<CheckResult> {
  const pidFile = MesaDaemon.readPidFile();
  if (!pidFile) {
    return { status: 'clear' };
  }

  try {
    const res = await httpRequest(
      {
        hostname: '127.0.0.1',
        port: pidFile.port,
        path: `/check?session=${encodeURIComponent(sessionId)}`,
        method: 'GET',
      },
      undefined,
      3000
    );
    return JSON.parse(res.body) as CheckResult;
  } catch {
    return { status: 'clear' };
  }
}

export function formatFindingsForAgent(checkResult: CheckResult): string {
  if (checkResult.status !== 'findings' || !checkResult.findings) {
    return '';
  }

  const allFindings = checkResult.findings.flatMap((r) => r.findings);
  if (allFindings.length === 0) return '';

  const errors = allFindings.filter((f) => f.severity === 'error');
  const warnings = allFindings.filter((f) => f.severity === 'warning');

  const formatEntry = (f: Finding) => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    return `- [${f.severity}] ${loc} - ${f.message}`;
  };

  const sections: string[] = [];
  sections.push('## Background Code Review Findings');
  sections.push('');
  sections.push('An independent reviewer analyzed your recent code changes and flagged the issues below.');
  sections.push('You wrote this code — you have the full context for why these changes were made.');
  sections.push('');
  sections.push('For each finding:');
  sections.push('- If the issue is valid and applicable to your work, fix it.');
  sections.push(
    '- If the finding is incorrect or not relevant given what you are doing, do not explain, just continue on.'
  );
  sections.push('');

  if (errors.length > 0) {
    sections.push('**Errors:**');
    sections.push(errors.map(formatEntry).join('\n'));
    sections.push('');
  }

  if (warnings.length > 0) {
    sections.push('**Warnings:**');
    sections.push(warnings.map(formatEntry).join('\n'));
    sections.push('');
  }

  return sections.join('\n');
}
