/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { QueueJobInput } from '../store.js';
import { DaemonStore } from '../store.js';

function makeDbPath(): string {
  return path.join(os.tmpdir(), `saguaro-stats-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

function cleanupDb(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
}

let store: DaemonStore;
let dbPath: string;

afterEach(() => {
  store?.close();
  if (dbPath) cleanupDb(dbPath);
});

function seedReviews(s: DaemonStore): void {
  // Job 1: done, fail verdict, 2 findings (1 error, 1 warning)
  const j1 = s.queueJob({
    sessionId: 's1',
    repoPath: '/tmp/repo-a',
    changedFiles: [{ path: 'a.ts', diff_hash: 'h1' }],
    agentSummary: null,
  })!;
  s.claimNextJob(1);
  s.completeJob(j1, 'done', 'sonnet', { costUsd: 0.05, inputTokens: 1000, outputTokens: 200, numTurns: 2 });
  s.insertReview({
    jobId: j1,
    verdict: 'fail',
    findings: [
      { file: 'a.ts', line: 10, message: 'SQL injection vulnerability', severity: 'error' },
      { file: 'a.ts', line: 20, message: 'Sequential awaits instead of Promise.all', severity: 'warning' },
    ],
  });

  // Job 2: done, pass verdict, no findings
  const j2 = s.queueJob({
    sessionId: 's1',
    repoPath: '/tmp/repo-b',
    changedFiles: [{ path: 'b.ts', diff_hash: 'h2' }],
    agentSummary: null,
  })!;
  s.claimNextJob(2);
  s.completeJob(j2, 'done', 'opus', { costUsd: 0.1, inputTokens: 2000, outputTokens: 400, numTurns: 5 });
  s.insertReview({ jobId: j2, verdict: 'pass', findings: null });

  // Job 3: failed
  const j3 = s.queueJob({
    sessionId: 's1',
    repoPath: '/tmp/repo-a',
    changedFiles: [{ path: 'c.ts', diff_hash: 'h3' }],
    agentSummary: null,
  })!;
  s.claimNextJob(3);
  s.completeJob(j3, 'failed', 'sonnet');
  s.insertReview({ jobId: j3, verdict: 'pass', findings: null });
}

describe('schema migration', () => {
  test('new columns exist after migration — completeJob with usage works', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);

    const jobId = store.queueJob({
      sessionId: 's1',
      repoPath: '/tmp/repo',
      changedFiles: [{ path: 'a.ts', diff_hash: 'h1' }],
      agentSummary: null,
    })!;
    store.claimNextJob(1); // must claim before completing

    store.completeJob(jobId, 'done', 'sonnet', {
      costUsd: 0.05,
      inputTokens: 1000,
      outputTokens: 200,
      numTurns: 3,
    });

    expect(jobId).toBe(1);
  });

  test('migration is idempotent — second DaemonStore on same DB does not throw', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    store.close();

    store = new DaemonStore(dbPath);
    expect(store).toBeDefined();
  });

  test('completeJob without usage still works (backward compat)', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);

    const jobId = store.queueJob({
      sessionId: 's1',
      repoPath: '/tmp/repo',
      changedFiles: [{ path: 'a.ts', diff_hash: 'h1' }],
      agentSummary: null,
    })!;
    store.claimNextJob(1);

    // 3-arg call (existing behavior)
    store.completeJob(jobId, 'done', 'sonnet');
    expect(jobId).toBe(1);
  });
});

describe('getStats', () => {
  test('aggregates overview correctly', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const stats = store.getStats('all');
    expect(stats.overview.totalReviews).toBe(3);
    expect(stats.overview.findings).toBe(2);
    expect(stats.overview.errors).toBe(1);
    expect(stats.overview.warnings).toBe(1);
    expect(stats.overview.failedJobs).toBe(1);
    expect(stats.overview.hitRate).toBeCloseTo(33.3, 0);
  });

  test('aggregates cost correctly', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const stats = store.getStats('all');
    expect(stats.cost).not.toBeNull();
    expect(stats.cost!.totalCostUsd).toBeCloseTo(0.15);
    expect(stats.cost!.totalInputTokens).toBe(3000);
    expect(stats.cost!.totalOutputTokens).toBe(600);
    expect(stats.cost!.reviewsWithCostData).toBe(2);
    expect(stats.cost!.avgCostPerReview).toBeCloseTo(0.075);
  });

  test('aggregates byModel correctly', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const stats = store.getStats('all');
    expect(stats.byModel.length).toBe(2);
    const sonnet = stats.byModel.find((m) => m.model === 'sonnet');
    expect(sonnet?.count).toBe(2);
  });

  test('aggregates byRepo correctly', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const stats = store.getStats('all');
    const repoA = stats.byRepo.find((r) => r.repo === '/tmp/repo-a');
    expect(repoA?.reviews).toBe(2);
    expect(repoA?.findings).toBe(2);
  });

  test('aggregates byCategory correctly', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const stats = store.getStats('all');
    const security = stats.byCategory.find((c) => c.category === 'security');
    expect(security?.count).toBe(1);
    const performance = stats.byCategory.find((c) => c.category === 'performance');
    expect(performance?.count).toBe(1);
  });

  test('returns null cost when no reviews have token data', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);

    const j1 = store.queueJob({
      sessionId: 's1',
      repoPath: '/tmp/r',
      changedFiles: [{ path: 'a.ts', diff_hash: 'h1' }],
      agentSummary: null,
    })!;
    store.claimNextJob(1);
    store.completeJob(j1, 'done', 'sonnet');
    store.insertReview({ jobId: j1, verdict: 'pass', findings: null });

    const stats = store.getStats('all');
    expect(stats.cost).toBeNull();
  });

  test('empty DB returns zeroed stats', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);

    const stats = store.getStats('all');
    expect(stats.overview.totalReviews).toBe(0);
    expect(stats.cost).toBeNull();
    expect(stats.byModel).toEqual([]);
  });
});

describe('getRecentFindings', () => {
  test('returns findings with categories', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const findings = store.getRecentFindings('all');
    expect(findings.length).toBe(2);
    expect(findings[0].categories.length).toBeGreaterThan(0);
  });

  test('filters by severity', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const errors = store.getRecentFindings('all', { severity: 'error' });
    expect(errors.length).toBe(1);
    expect(errors[0].severity).toBe('error');
  });

  test('filters by repo', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const findings = store.getRecentFindings('all', { repo: '/tmp/repo-b' });
    expect(findings.length).toBe(0);
  });

  test('returns review context fields (model, costUsd, completedAt)', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);
    seedReviews(store);

    const findings = store.getRecentFindings('all');
    expect(findings.length).toBe(2);
    expect(findings[0].model).toBe('sonnet');
    expect(findings[0].costUsd).toBe(0.05);
    expect(findings[0].completedAt).toBeDefined();
    expect(typeof findings[0].completedAt).toBe('string');
  });

  test('returns null model/cost when job has no usage data', () => {
    dbPath = makeDbPath();
    store = new DaemonStore(dbPath);

    const j1 = store.queueJob({
      sessionId: 's1',
      repoPath: '/tmp/repo',
      changedFiles: [{ path: 'x.ts', diff_hash: 'hx' }],
      agentSummary: null,
    })!;
    store.claimNextJob(1);
    store.completeJob(j1, 'done');
    store.insertReview({
      jobId: j1,
      verdict: 'fail',
      findings: [{ file: 'x.ts', line: 1, message: 'dead code found', severity: 'warning' }],
    });

    const findings = store.getRecentFindings('all');
    expect(findings.length).toBe(1);
    expect(findings[0].model).toBeNull();
    expect(findings[0].costUsd).toBeNull();
  });
});
