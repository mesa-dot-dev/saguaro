/**
 * Runtime-adaptive SQLite adapter.
 *
 * - Under Bun (tests, bun-compiled binaries): uses bun:sqlite
 * - Under Node.js (production CLI): uses better-sqlite3
 *
 * Both libraries have nearly identical APIs. This adapter normalizes
 * the small differences so the store doesn't need to care.
 */

// Sloppy file that sped up development, clean up in the future.

import { createRequire } from 'node:module';

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
}

export interface SqliteStatement {
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

function isBun(): boolean {
  return typeof globalThis.Bun !== 'undefined';
}

export function openDatabase(dbPath: string): SqliteDatabase {
  if (isBun()) {
    return openBunSqlite(dbPath);
  }
  return openBetterSqlite3(dbPath);
}

function openBunSqlite(dbPath: string): SqliteDatabase {
  // Use createRequire to load bun:sqlite — avoids Node.js static analysis choking on the bun: protocol
  const bunRequire = createRequire(import.meta.url);
  const { Database } = bunRequire('bun:sqlite') as {
    Database: new (path: string, opts?: Record<string, unknown>) => BunDatabase;
  };
  const db = new Database(dbPath, { create: true, strict: true });
  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA busy_timeout = 30000;');

  return {
    exec(sql: string) {
      // bun:sqlite doesn't have exec(), but run() works for DDL
      for (const stmt of sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)) {
        db.run(`${stmt};`);
      }
    },
    prepare(sql: string) {
      const stmt = db.query(sql);
      return {
        run(...params: unknown[]) {
          return stmt.run(...params) as { lastInsertRowid: number | bigint; changes: number };
        },
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        all(...params: unknown[]) {
          return stmt.all(...params) as unknown[];
        },
      };
    },
    close() {
      db.close();
    },
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      // bun:sqlite has db.transaction() but with slightly different semantics
      // Wrap in a simple BEGIN/COMMIT
      return ((...args: unknown[]) => {
        db.run('BEGIN');
        try {
          const result = fn(...args);
          db.run('COMMIT');
          return result;
        } catch (e) {
          db.run('ROLLBACK');
          throw e;
        }
      }) as T;
    },
  };
}

// Bun's Database type (minimal interface for what we use)
interface BunDatabase {
  run(sql: string): unknown;
  query(sql: string): { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
  close(): void;
}

function openBetterSqlite3(dbPath: string): SqliteDatabase {
  // Use createRequire because this is an ESM module and require() is not available under Node.js
  const nodeRequire = createRequire(import.meta.url);
  const BetterSqlite3 = nodeRequire('better-sqlite3') as { new (path: string): BetterSqlite3Database };
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 30000');

  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      return {
        run(...params: unknown[]) {
          return stmt.run(...params) as { lastInsertRowid: number | bigint; changes: number };
        },
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        all(...params: unknown[]) {
          return stmt.all(...params) as unknown[];
        },
      };
    },
    close() {
      db.close();
    },
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      return db.transaction(fn) as T;
    },
  };
}

// better-sqlite3's Database type (minimal interface for what we use)
interface BetterSqlite3Database {
  exec(sql: string): void;
  pragma(str: string): unknown;
  prepare(sql: string): {
    run(...p: unknown[]): unknown;
    get(...p: unknown[]): unknown;
    all(...p: unknown[]): unknown[];
  };
  close(): void;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
}
