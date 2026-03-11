import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { isSaguaroOnPath, resolveDistBin } from '../util/resolve-bin.js';
import { SaguaroDaemon } from './server.js';
import type { Finding, QueueJobInput } from './store.js';

export interface CheckResult {
  status: 'clear' | 'findings';
  pending?: boolean;
  oldest_pending_age_ms?: number | null;
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

const LOCK_FILE_PATH = path.join(os.homedir(), '.saguaro', 'daemon.lock');

function pollForPidFile(maxWaitMs: number, intervalMs: number): Promise<{ port: number } | null> {
  return new Promise((resolve) => {
    let waited = 0;
    const check = () => {
      const pf = SaguaroDaemon.readPidFile();
      if (pf) {
        resolve({ port: pf.port });
        return;
      }
      waited += intervalMs;
      if (waited >= maxWaitMs) {
        resolve(null);
        return;
      }
      setTimeout(check, intervalMs);
    };
    setTimeout(check, intervalMs);
  });
}

async function ensureDaemonRunning(): Promise<{ port: number } | null> {
  const pidFile = SaguaroDaemon.readPidFile();
  if (pidFile) {
    return { port: pidFile.port };
  }

  // Use an exclusive lock file to prevent multiple processes from spawning
  // concurrent daemons. O_EXCL fails if the file already exists.
  fs.mkdirSync(path.dirname(LOCK_FILE_PATH), { recursive: true });

  // Clean up stale lock files from crashed processes (older than 10s).
  try {
    const stat = fs.statSync(LOCK_FILE_PATH);
    if (Date.now() - stat.mtimeMs > 10_000) {
      fs.unlinkSync(LOCK_FILE_PATH);
    }
  } catch {
    // File doesn't exist — that's fine.
  }

  let lockFd: number;
  try {
    lockFd = fs.openSync(LOCK_FILE_PATH, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
    fs.writeSync(lockFd, String(process.pid));
    fs.closeSync(lockFd);
  } catch {
    // Another process is already spawning the daemon — just wait for it.
    return pollForPidFile(6000, 200);
  }

  try {
    let command: string;
    let args: string[];
    if (isSaguaroOnPath()) {
      command = 'sag';
      args = ['daemon', 'start'];
    } else {
      const distBin = resolveDistBin(import.meta.url);
      command = 'node';
      args = [distBin, 'daemon', 'start'];
    }

    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    return await pollForPidFile(6000, 200);
  } finally {
    // Clean up the lock file so future invocations can spawn if needed.
    try {
      fs.unlinkSync(LOCK_FILE_PATH);
    } catch {
      // Already removed
    }
  }
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
 */
export async function checkDaemonWithPolling(
  sessionId: string,
  maxWaitMs = 15000,
  pollIntervalMs = 3000
): Promise<CheckResult> {
  const first = await checkDaemon(sessionId);

  // If we already have findings or nothing is pending, return immediately.
  if (first.status === 'findings' || !first.pending) {
    return first;
  }

  // If the oldest pending job is very fresh (< 5s), it won't finish in time.
  // Return immediately instead of blocking the agent.
  if (first.oldest_pending_age_ms != null && first.oldest_pending_age_ms < 5000) {
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
  const pidFile = SaguaroDaemon.readPidFile();
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

  const parts: string[] = ['Saguaro review — fix valid issues, dismiss the rest.'];
  for (const f of allFindings) {
    const short = path.basename(f.file);
    const loc = f.line ? `${short}:${f.line}` : short;
    parts.push(`[${f.severity}] ${loc} — ${f.message}`);
  }
  return parts.join('\n\n');
}
