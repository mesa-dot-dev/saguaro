import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type SqliteDatabase } from './db.js';
import type { AgentUsage } from './stats-types.js';

// Logic inspired by and adapted from Roborev Storage

export interface ChangedFile {
  path: string;
  diff_hash: string;
}

export interface QueueJobInput {
  sessionId: string;
  repoPath: string;
  changedFiles: ChangedFile[];
  agentSummary: string | null;
}

export interface ReviewJob {
  id: number;
  sessionId: string;
  repoPath: string;
  changedFiles: string; // JSON: ChangedFile[]
  agentSummary: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  workerId: number | null;
  model: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Finding {
  file: string;
  line: number | null;
  message: string;
  severity: 'error' | 'warning';
}

export interface InsertReviewInput {
  jobId: number;
  verdict: 'pass' | 'fail';
  findings: Finding[] | null;
}

export interface Review {
  id: number;
  jobId: number;
  verdict: 'pass' | 'fail';
  findings: string | null; // JSON: Finding[]
  shown: number;
  createdAt: string;
}

interface ReviewJobRow {
  id: number;
  session_id: string;
  repo_path: string;
  changed_files: string;
  agent_summary: string | null;
  status: string;
  worker_id: number | null;
  model: string | null;
  claimed_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface ReviewRow {
  id: number;
  job_id: number;
  verdict: string;
  findings: string | null;
  shown: number;
  created_at: string;
}

/** Deterministic key for a set of changed files, used for deduplication. */
function changedFilesKey(files: ChangedFile[]): string {
  return [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `${f.path}:${f.diff_hash}`)
    .join('\n');
}

function mapJobRow(row: ReviewJobRow): ReviewJob {
  return {
    id: row.id,
    sessionId: row.session_id,
    repoPath: row.repo_path,
    changedFiles: row.changed_files,
    agentSummary: row.agent_summary,
    status: row.status as ReviewJob['status'],
    workerId: row.worker_id,
    model: row.model,
    claimedAt: row.claimed_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function mapReviewRow(row: ReviewRow): Review {
  return {
    id: row.id,
    jobId: row.job_id,
    verdict: row.verdict as Review['verdict'],
    findings: row.findings,
    shown: row.shown,
    createdAt: row.created_at,
  };
}

const DEFAULT_DB_PATH = path.join(os.homedir(), '.saguaro', 'reviews.db');

export class DaemonStore {
  private db: SqliteDatabase;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    this.db = openDatabase(dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS review_jobs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id      TEXT NOT NULL,
        repo_path       TEXT NOT NULL,
        changed_files   TEXT NOT NULL,
        agent_summary   TEXT,
        status          TEXT NOT NULL DEFAULT 'queued',
        worker_id       INTEGER,
        model           TEXT,
        claimed_at      TEXT,
        completed_at    TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS reviews (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id          INTEGER NOT NULL REFERENCES review_jobs(id),
        verdict         TEXT NOT NULL,
        findings        TEXT,
        shown           INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON review_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_jobs_session ON review_jobs(session_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_job ON reviews(job_id);
    `);

    // Incremental migration: add usage tracking columns (idempotent)
    for (const col of ['cost_usd REAL', 'input_tokens INTEGER', 'output_tokens INTEGER', 'num_turns INTEGER']) {
      try {
        this.db.exec(`ALTER TABLE review_jobs ADD COLUMN ${col}`);
      } catch {
        // Column already exists — expected on subsequent runs
      }
    }
  }

  /**
   * Queue a review job, skipping if an identical job (same session + same file hashes)
   * is already queued, running, or completed successfully. Failed jobs are excluded
   * so the same diff can be retried. Returns the job ID, or null if deduplicated.
   */
  queueJob(input: QueueJobInput): number | null {
    if (this.hasJobForFiles(input.sessionId, input.changedFiles)) {
      return null;
    }

    const result = this.db
      .prepare(`
      INSERT INTO review_jobs (session_id, repo_path, changed_files, agent_summary)
      VALUES (?, ?, ?, ?)
    `)
      .run(input.sessionId, input.repoPath, JSON.stringify(input.changedFiles), input.agentSummary);
    return Number(result.lastInsertRowid);
  }

  /**
   * Check whether there's already a job for this session with the same set of
   * changed files and diff hashes — whether it's still active or already done.
   * This prevents re-queueing reviews when the diff hasn't changed between turns.
   */
  private hasJobForFiles(sessionId: string, changedFiles: ChangedFile[]): boolean {
    const rows = this.db
      .prepare(`
      SELECT changed_files FROM review_jobs
      WHERE session_id = ? AND status IN ('queued', 'running', 'done')
    `)
      .all(sessionId) as { changed_files: string }[];

    const newKey = changedFilesKey(changedFiles);
    return rows.some((row) => changedFilesKey(JSON.parse(row.changed_files)) === newKey);
  }

  claimNextJob(workerId: number): ReviewJob | null {
    const row = this.db
      .prepare(`
      UPDATE review_jobs
      SET status = 'running', worker_id = ?, claimed_at = datetime('now')
      WHERE id = (
        SELECT id FROM review_jobs
        WHERE status = 'queued'
        ORDER BY id ASC
        LIMIT 1
      )
      RETURNING *
    `)
      .get(workerId) as ReviewJobRow | undefined;
    return row ? mapJobRow(row) : null;
  }

  completeJob(jobId: number, status: 'done' | 'failed', model?: string, usage?: AgentUsage): void {
    if (usage) {
      this.db
        .prepare(`
        UPDATE review_jobs
        SET status = ?, model = ?, completed_at = datetime('now'),
            cost_usd = ?, input_tokens = ?, output_tokens = ?, num_turns = ?
        WHERE id = ?
      `)
        .run(status, model ?? null, usage.costUsd, usage.inputTokens, usage.outputTokens, usage.numTurns, jobId);
    } else if (model) {
      this.db
        .prepare(`
        UPDATE review_jobs SET status = ?, model = ?, completed_at = datetime('now') WHERE id = ?
      `)
        .run(status, model, jobId);
    } else {
      this.db
        .prepare(`
        UPDATE review_jobs SET status = ?, completed_at = datetime('now') WHERE id = ?
      `)
        .run(status, jobId);
    }
  }

  resetStaleJobs(): number {
    const result = this.db
      .prepare(`
      UPDATE review_jobs
      SET status = 'queued', worker_id = NULL, claimed_at = NULL
      WHERE status = 'running'
    `)
      .run();
    return result.changes;
  }

  hasPendingJobs(sessionId: string): boolean {
    const row = this.db
      .prepare(`
      SELECT COUNT(*) as count FROM review_jobs
      WHERE session_id = ? AND status IN ('queued', 'running')
    `)
      .get(sessionId) as { count: number } | undefined;
    return (row?.count ?? 0) > 0;
  }

  /**
   * Returns the age in milliseconds of the oldest pending/running job
   * for this session, or null if no pending jobs exist.
   */
  getOldestPendingAge(sessionId: string): number | null {
    const row = this.db
      .prepare(`
      SELECT created_at FROM review_jobs
      WHERE session_id = ? AND status IN ('queued', 'running')
      ORDER BY id ASC
      LIMIT 1
    `)
      .get(sessionId) as { created_at: string } | undefined;
    if (!row) return null;
    // SQLite datetime('now') stores UTC without Z suffix
    return Date.now() - new Date(`${row.created_at}Z`).getTime();
  }

  insertReview(input: InsertReviewInput): number {
    const result = this.db
      .prepare(`
      INSERT INTO reviews (job_id, verdict, findings) VALUES (?, ?, ?)
    `)
      .run(input.jobId, input.verdict, input.findings ? JSON.stringify(input.findings) : null);
    return Number(result.lastInsertRowid);
  }

  /**
   * Returns a map of filePath -> diff_hash for all changed files across
   * completed (done) jobs in the given session. This allows callers to
   * skip files whose diffs haven't changed since the last review.
   */
  getReviewedDiffHashes(sessionId: string): Map<string, string> {
    const rows = this.db
      .prepare(`
      SELECT changed_files FROM review_jobs
      WHERE session_id = ? AND status = 'done'
    `)
      .all(sessionId) as { changed_files: string }[];

    const result = new Map<string, string>();
    for (const row of rows) {
      const files: ChangedFile[] = JSON.parse(row.changed_files);
      for (const f of files) {
        result.set(f.path, f.diff_hash);
      }
    }
    return result;
  }

  getUnshownFindings(sessionId: string): Review[] {
    const rows = this.db
      .prepare(`
      SELECT r.id, r.job_id, r.verdict, r.findings, r.shown, r.created_at
      FROM reviews r
      JOIN review_jobs j ON r.job_id = j.id
      WHERE j.session_id = ? AND r.verdict = 'fail' AND r.shown = 0
    `)
      .all(sessionId) as ReviewRow[];
    return rows.map(mapReviewRow);
  }

  markShown(reviewIds: number[]): void {
    if (reviewIds.length === 0) return;
    const stmt = this.db.prepare('UPDATE reviews SET shown = 1 WHERE id = ?');
    const markMany = this.db.transaction((...args: unknown[]) => {
      const ids = args[0] as number[];
      for (const id of ids) stmt.run(id);
    });
    markMany(reviewIds);
  }

  close(): void {
    this.db.close();
  }
}
