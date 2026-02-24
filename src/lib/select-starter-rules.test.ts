/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import type { StarterRule } from '../templates/starter-rules.js';
import { selectStarterRules } from './select-starter-rules.js';

const makeRule = (id: string, ecosystems: string[], requires?: { files: string[] }): StarterRule => ({
  id,
  title: `Rule ${id}`,
  severity: 'error',
  globs: ['**/*.ts'],
  instructions: `Instructions for ${id}`,
  ecosystems,
  ...(requires ? { requires } : {}),
});

// ── selectStarterRules ──────────────────────────────────────────────

describe('selectStarterRules', () => {
  const alwaysMatch = () => true;
  const neverMatch = () => false;

  test('selects rules with no ecosystem requirement (universal rules)', () => {
    const catalog = [makeRule('universal-1', []), makeRule('universal-2', [])];
    const result = selectStarterRules(catalog, new Set(), alwaysMatch);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['universal-1', 'universal-2']);
  });

  test('selects rules when all ecosystems are present', () => {
    const catalog = [makeRule('ts-react', ['typescript', 'react'])];
    const result = selectStarterRules(catalog, new Set(['typescript', 'react', 'nextjs']), alwaysMatch);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('ts-react');
  });

  test('excludes rules when any ecosystem is missing', () => {
    const catalog = [makeRule('ts-react', ['typescript', 'react'])];
    const result = selectStarterRules(catalog, new Set(['typescript']), alwaysMatch);
    expect(result).toHaveLength(0);
  });

  test('excludes rules when requires.files do not match', () => {
    const catalog = [makeRule('prisma-rule', ['typescript'], { files: ['prisma/schema.prisma'] })];
    const result = selectStarterRules(catalog, new Set(['typescript']), neverMatch);
    expect(result).toHaveLength(0);
  });

  test('includes rules when requires.files match', () => {
    const catalog = [makeRule('prisma-rule', ['typescript'], { files: ['prisma/schema.prisma'] })];
    const result = selectStarterRules(catalog, new Set(['typescript']), alwaysMatch);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('prisma-rule');
  });

  test('returns clean RulePolicy without ecosystems/requires fields', () => {
    const catalog = [makeRule('clean-check', ['typescript'], { files: ['**/*.ts'] })];
    const result = selectStarterRules(catalog, new Set(['typescript']), alwaysMatch);
    expect(result).toHaveLength(1);

    const policy = result[0];
    expect(policy.id).toBe('clean-check');
    expect(policy.title).toBe('Rule clean-check');
    expect(policy.severity).toBe('error');
    expect(policy.globs).toEqual(['**/*.ts']);
    expect(policy.instructions).toBe('Instructions for clean-check');

    // Ensure StarterRule-specific fields are stripped
    expect('ecosystems' in policy).toBe(false);
    expect('requires' in policy).toBe(false);
  });

  test('mixed scenario: universal + specific rules with partial ecosystem match', () => {
    const catalog = [
      makeRule('universal', []),
      makeRule('ts-only', ['typescript']),
      makeRule('ts-react', ['typescript', 'react']),
      makeRule('python-django', ['python', 'django']),
      makeRule('go-rule', ['go']),
      makeRule('ts-with-prisma', ['typescript'], { files: ['prisma/schema.prisma'] }),
    ];

    const detected = new Set(['typescript', 'react']);

    // fileMatchChecker: only match prisma files when asked
    const checker = (globs: string[]) => globs.some((g) => g.includes('prisma'));

    const result = selectStarterRules(catalog, detected, checker);
    const ids = result.map((r) => r.id);

    // universal: included (no ecosystem requirement)
    expect(ids).toContain('universal');
    // ts-only: included (typescript is detected)
    expect(ids).toContain('ts-only');
    // ts-react: included (both typescript and react detected)
    expect(ids).toContain('ts-react');
    // python-django: excluded (python and django not detected)
    expect(ids).not.toContain('python-django');
    // go-rule: excluded (go not detected)
    expect(ids).not.toContain('go-rule');
    // ts-with-prisma: included (typescript detected + prisma files match)
    expect(ids).toContain('ts-with-prisma');

    expect(result).toHaveLength(4);
  });
});
