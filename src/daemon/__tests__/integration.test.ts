import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { formatFindingsForAgent } from '../hook-client.js';
import { DaemonStore } from '../store.js';

describe('Daemon integration', () => {
  let store: DaemonStore;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `mesa-integration-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    store = new DaemonStore(dbPath);
  });

  afterEach(() => {
    store.close();
    for (const ext of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync(dbPath + ext);
      } catch {}
    }
  });

  it('should handle full lifecycle: queue -> claim -> complete -> check', () => {
    const jobId = store.queueJob({
      sessionId: 'test-session',
      repoPath: '/tmp/repo',
      changedFiles: [{ path: 'src/auth.ts', diff_hash: 'abc123' }],
      agentSummary: 'Refactored the auth module to use JWT',
    })!;

    expect(store.hasPendingJobs('test-session')).toBe(true);

    const job = store.claimNextJob(0);
    expect(job).not.toBeNull();
    expect(job!.id).toBe(jobId);

    store.completeJob(jobId, 'done', 'claude');
    expect(store.hasPendingJobs('test-session')).toBe(false);

    store.insertReview({
      jobId,
      verdict: 'fail',
      findings: [{ file: 'src/auth.ts', line: 47, message: 'SQL interpolation allows injection', severity: 'error' }],
    });

    const unseen = store.getUnshownFindings('test-session');
    expect(unseen).toHaveLength(1);

    store.markShown(unseen.map((v) => v.id));
    expect(store.getUnshownFindings('test-session')).toHaveLength(0);
  });

  it('should format findings for agent injection', () => {
    const formatted = formatFindingsForAgent({
      status: 'findings',
      findings: [
        {
          id: 1,
          findings: [
            { file: 'src/auth.ts', line: 47, message: 'SQL interpolation', severity: 'error' },
            { file: 'src/routes.ts', line: 12, message: 'Missing auth check', severity: 'warning' },
          ],
        },
      ],
    });

    expect(formatted).toContain('Mesa review');
    expect(formatted).toContain('[error] auth.ts:47');
    expect(formatted).toContain('[warning] routes.ts:12');
  });

  it('should return empty string for clear results', () => {
    expect(formatFindingsForAgent({ status: 'clear' })).toBe('');
  });

  it('should handle multiple review jobs for the same session', () => {
    const jobId1 = store.queueJob({
      sessionId: 'session-multi',
      repoPath: '/tmp/repo',
      changedFiles: [{ path: 'a.ts', diff_hash: 'hash-a' }],
      agentSummary: null,
    })!;
    const jobId2 = store.queueJob({
      sessionId: 'session-multi',
      repoPath: '/tmp/repo',
      changedFiles: [{ path: 'b.ts', diff_hash: 'hash-b' }],
      agentSummary: null,
    })!;

    expect(store.hasPendingJobs('session-multi')).toBe(true);

    // Claim and complete both
    store.claimNextJob(0);
    store.claimNextJob(1);
    store.completeJob(jobId1, 'done', 'claude');
    store.completeJob(jobId2, 'done', 'claude');

    expect(store.hasPendingJobs('session-multi')).toBe(false);

    // Insert findings for both
    store.insertReview({
      jobId: jobId1,
      verdict: 'fail',
      findings: [{ file: 'a.ts', line: 1, message: 'issue a', severity: 'error' }],
    });
    store.insertReview({
      jobId: jobId2,
      verdict: 'fail',
      findings: [{ file: 'b.ts', line: 1, message: 'issue b', severity: 'warning' }],
    });

    const unseen = store.getUnshownFindings('session-multi');
    expect(unseen).toHaveLength(2);

    // Mark all shown
    store.markShown(unseen.map((v) => v.id));
    expect(store.getUnshownFindings('session-multi')).toHaveLength(0);
  });

  it('should isolate sessions from each other', () => {
    const jobId1 = store.queueJob({
      sessionId: 'session-a',
      repoPath: '/tmp/repo',
      changedFiles: [{ path: 'a.ts', diff_hash: 'hash-a' }],
      agentSummary: null,
    })!;
    const jobId2 = store.queueJob({
      sessionId: 'session-b',
      repoPath: '/tmp/repo',
      changedFiles: [{ path: 'b.ts', diff_hash: 'hash-b' }],
      agentSummary: null,
    })!;

    store.claimNextJob(0);
    store.claimNextJob(1);
    store.completeJob(jobId1, 'done', 'claude');
    store.completeJob(jobId2, 'done', 'claude');

    store.insertReview({
      jobId: jobId1,
      verdict: 'fail',
      findings: [{ file: 'a.ts', line: 1, message: 'x', severity: 'error' }],
    });
    store.insertReview({
      jobId: jobId2,
      verdict: 'pass',
      findings: null,
    });

    // Session A has findings, Session B does not
    expect(store.getUnshownFindings('session-a')).toHaveLength(1);
    expect(store.getUnshownFindings('session-b')).toHaveLength(0);
  });

  it('should track reviewed file hashes across jobs', () => {
    // Job 1: review files A and B
    const job1 = store.queueJob({
      sessionId: 'session-scope',
      repoPath: '/tmp/repo',
      changedFiles: [
        { path: 'a.ts', diff_hash: 'hash1' },
        { path: 'b.ts', diff_hash: 'hash2' },
      ],
      agentSummary: null,
    })!;
    store.claimNextJob(0);
    store.completeJob(job1, 'done', 'claude');
    store.insertReview({ jobId: job1, verdict: 'pass', findings: null });

    // Check reviewed hashes
    const hashes = store.getReviewedDiffHashes('session-scope');
    expect(hashes.get('a.ts')).toBe('hash1');
    expect(hashes.get('b.ts')).toBe('hash2');

    // Job 2: A was re-edited (hash changed), C is new
    const job2files = [
      { path: 'a.ts', diff_hash: 'hash1-v2' },
      { path: 'b.ts', diff_hash: 'hash2' }, // unchanged
      { path: 'c.ts', diff_hash: 'hash3' }, // new
    ];

    // Filter like the worker would
    const toReview = job2files.filter((f) => {
      const prev = hashes.get(f.path);
      return !prev || prev !== f.diff_hash;
    });

    expect(toReview.map((f) => f.path)).toEqual(['a.ts', 'c.ts']);
  });
});
