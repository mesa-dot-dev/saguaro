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
