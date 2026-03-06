import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type AgentName, detectInstalledAgent } from './agent-cli.js';
import { DaemonStore, type QueueJobInput } from './store.js';
import { runWorker, type WorkerConfig } from './worker.js';

// Much of this logic is translated from Roborev: https://github.com/roborev-dev/roborev/blob/main/internal/daemon/server.go

export interface DaemonConfig {
  port?: number;
  workers: number;
  idleTimeout: number;
  agent: string;
  model?: string;
}

interface PidFile {
  pid: number;
  port: number;
  startedAt: string;
}

const PID_DIR = path.join(os.homedir(), '.mesa');
const PID_FILE_PATH = path.join(PID_DIR, 'daemon.pid');
const DEFAULT_PORT = 7474;
const WORKER_POLL_MS = 2000;
const IDLE_CHECK_MS = 60_000;

export class MesaDaemon {
  private server: http.Server | null = null;
  private store: DaemonStore;
  private config: DaemonConfig;
  private workerTimers: ReturnType<typeof setInterval>[] = [];
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity: number = Date.now();
  private detectedAgent: AgentName | null = null;
  private running = false;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.store = new DaemonStore();
    this.detectedAgent = detectInstalledAgent(config.agent);
  }

  async start(): Promise<number> {
    if (!this.detectedAgent) {
      throw new Error(
        `[mesa-daemon] No CLI found for provider "${this.config.agent}". Install it or change model.provider in .mesa/config.yaml`
      );
    }

    // Clean up zombie daemons (stale PID files where process died)
    MesaDaemon.cleanupStalePidFile();

    // Reset jobs stuck in 'running' from a crashed daemon
    const reset = this.store.resetStaleJobs();
    if (reset > 0) {
      console.log(`[mesa-daemon] Reset ${reset} stale jobs to queued`);
    }

    const port = await this.findAvailablePort(this.config.port ?? DEFAULT_PORT);

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(port, '127.0.0.1', () => {
        this.running = true;
        this.writePidFile(port);
        this.startWorkers();
        this.startIdleWatcher();
        console.log(
          `[mesa-daemon] Started on port ${port} with ${this.config.workers} workers (agent: ${this.detectedAgent})`
        );
        resolve(port);
      });

      this.server.on('error', reject);
    });
  }

  stop(): void {
    this.running = false;

    for (const timer of this.workerTimers) {
      clearTimeout(timer);
    }
    this.workerTimers = [];

    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    this.store.close();
    this.removePidFile();
    console.log('[mesa-daemon] Stopped');
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.lastActivity = Date.now();
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'POST' && url.pathname === '/review') {
      this.handleReview(req, res);
    } else if (req.method === 'GET' && url.pathname === '/check') {
      this.handleCheck(url, res);
    } else if (req.method === 'GET' && url.pathname === '/status') {
      this.handleStatus(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  }

  private handleReview(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body) as QueueJobInput;
        const jobId = this.store.queueJob(payload);
        if (jobId === null) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'skipped', reason: 'duplicate' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'queued', job_id: jobId }));
      } catch (error) {
        console.error('[mesa-daemon] Error handling /review:', error);
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  }

  private handleCheck(url: URL, res: http.ServerResponse): void {
    const sessionId = url.searchParams.get('session');
    if (!sessionId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Missing session parameter' }));
      return;
    }

    const findings = this.store.getUnshownFindings(sessionId);
    const pending = this.store.hasPendingJobs(sessionId);
    const oldestPendingAgeMs = pending ? this.store.getOldestPendingAge(sessionId) : null;
    // ?peek=true allows debugging without triggering the db as "read"
    const peek = url.searchParams.get('peek') === 'true';

    if (findings.length > 0) {
      if (!peek) {
        this.store.markShown(findings.map((f) => f.id));
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'findings',
          pending,
          oldest_pending_age_ms: oldestPendingAgeMs,
          findings: findings.map((f) => ({
            id: f.id,
            findings: f.findings ? JSON.parse(f.findings) : [],
          })),
        })
      );
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'clear', pending, oldest_pending_age_ms: oldestPendingAgeMs }));
    }
  }

  private handleStatus(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        running: this.running,
        agent: this.detectedAgent,
        workers: this.config.workers,
      })
    );
  }

  private startWorkers(): void {
    const workerConfig: WorkerConfig = {
      agent: this.detectedAgent!,
      model: this.config.model,
    };

    for (let i = 0; i < this.config.workers; i++) {
      const workerId = i;
      const poll = async () => {
        if (!this.running) return;
        try {
          await runWorker(this.store, workerId, workerConfig);
        } catch (error) {
          console.error(`[mesa-daemon] Worker ${workerId} error:`, error);
        }
        if (this.running) {
          this.workerTimers[workerId] = setTimeout(poll, WORKER_POLL_MS);
        }
      };
      this.workerTimers[workerId] = setTimeout(poll, WORKER_POLL_MS);
    }
  }

  private startIdleWatcher(): void {
    this.idleTimer = setInterval(() => {
      const idleMs = Date.now() - this.lastActivity;
      if (idleMs > this.config.idleTimeout * 1000) {
        console.log('[mesa-daemon] Idle timeout reached, shutting down');
        this.stop();
        process.exit(0);
      }
    }, IDLE_CHECK_MS);
  }

  private findAvailablePort(preferred: number, maxAttempts = 50): Promise<number> {
    return new Promise((resolve, reject) => {
      if (maxAttempts <= 0) {
        reject(new Error(`[mesa-daemon] Could not find an available port after scanning from ${DEFAULT_PORT}`));
        return;
      }
      const testServer = http.createServer();
      testServer.listen(preferred, '127.0.0.1', () => {
        testServer.close(() => resolve(preferred));
      });
      testServer.on('error', () => {
        testServer.close(() => {
          this.findAvailablePort(preferred + 1, maxAttempts - 1).then(resolve, reject);
        });
      });
    });
  }

  private writePidFile(port: number): void {
    const pidFile: PidFile = {
      pid: process.pid,
      port,
      startedAt: new Date().toISOString(),
    };
    fs.mkdirSync(PID_DIR, { recursive: true });

    // Atomic write: write to temp file then rename
    const tmpPath = `${PID_FILE_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(pidFile, null, 2));
    fs.renameSync(tmpPath, PID_FILE_PATH);
  }

  private removePidFile(): void {
    try {
      fs.unlinkSync(PID_FILE_PATH);
    } catch {
      // File already gone
    }
  }

  /**
   * Read the PID file and verify the daemon process is still alive.
   * Returns the PID file contents if the daemon is running, null otherwise.
   * Cleans up stale PID files where the process has died.
   */
  static readPidFile(): PidFile | null {
    let raw: string;
    try {
      raw = fs.readFileSync(PID_FILE_PATH, 'utf8');
    } catch {
      return null;
    }

    let pidFile: PidFile;
    try {
      pidFile = JSON.parse(raw) as PidFile;
    } catch {
      MesaDaemon.cleanupStalePidFile();
      return null;
    }

    try {
      process.kill(pidFile.pid, 0);
      return pidFile;
    } catch (err: unknown) {
      // EPERM means process exists but we can't signal it — treat as running
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPERM') {
        return pidFile;
      }
      // ESRCH or other errors mean process is dead
      MesaDaemon.cleanupStalePidFile();
      return null;
    }
  }

  /**
   * Remove a stale PID file (process died without cleanup).
   */
  static cleanupStalePidFile(): void {
    try {
      fs.unlinkSync(PID_FILE_PATH);
    } catch {
      // File already gone
    }
  }

  /**
   * Convenience: check if a daemon is currently running.
   */
  static isRunning(): boolean {
    return MesaDaemon.readPidFile() !== null;
  }
}
