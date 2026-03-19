/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { categorizeFinding } from '../categorize.js';

describe('categorizeFinding', () => {
  test('returns uncategorized for empty message', () => {
    expect(categorizeFinding('')).toEqual(['uncategorized']);
  });

  test('detects security findings', () => {
    const cats = categorizeFinding('IDOR / missing org scope on update');
    expect(cats[0]).toBe('security');
  });

  test('detects bug findings', () => {
    const cats = categorizeFinding('will throw TypeError: undefined is not iterable');
    expect(cats[0]).toBe('bug');
  });

  test('detects regression findings', () => {
    const cats = categorizeFinding('Throwing on missing repo is a regression. The old code silently dropped it.');
    expect(cats[0]).toBe('regression');
  });

  test('detects performance findings', () => {
    const cats = categorizeFinding('Sequential awaits instead of Promise.all, serializing N parallel calls');
    expect(cats[0]).toBe('performance');
  });

  test('detects dead-code findings', () => {
    const cats = categorizeFinding('Dead prop: repo is declared but never used');
    expect(cats[0]).toBe('dead-code');
  });

  test('detects error-handling findings', () => {
    const cats = categorizeFinding('no error handling around the database write operation');
    expect(cats[0]).toBe('error-handling');
  });

  test('detects race-condition findings', () => {
    const cats = categorizeFinding('race condition: no concurrency guard');
    expect(cats[0]).toBe('race-condition');
  });

  test('detects merge-conflict findings', () => {
    const cats = categorizeFinding('Unresolved merge conflict markers in the file');
    expect(cats[0]).toBe('merge-conflict');
  });

  test('detects needless-complexity findings', () => {
    const cats = categorizeFinding('Needlessly complex: reimplements Math.min with a hand-rolled loop');
    expect(cats[0]).toBe('needless-complexity');
  });

  test('detects spec-issue findings', () => {
    const cats = categorizeFinding('Task 2 Step 1 instructs adding a field that already exists');
    expect(cats[0]).toBe('spec-issue');
  });

  test('returns multiple categories when message matches several', () => {
    const cats = categorizeFinding('Hardcoded 50ms sleep adds latency — a regression from the previous parallel approach');
    expect(cats.length).toBeGreaterThan(1);
    expect(cats).toContain('performance');
    expect(cats).toContain('regression');
  });

  test('priority order: security before bug', () => {
    const cats = categorizeFinding('SQL injection: attacker can break out and crash the process');
    expect(cats[0]).toBe('security');
  });

  test('falls back to uncategorized for unrecognizable messages', () => {
    const cats = categorizeFinding('The denominator is all expectations, not just the negative class');
    expect(cats).toContain('uncategorized');
  });
});
