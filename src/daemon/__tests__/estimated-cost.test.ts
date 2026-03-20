/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { estimateCost } from '../estimated-cost.js';

describe('estimateCost', () => {
  test('calculates opus cost correctly', () => {
    // 1M input * $5/M + 500K output * $25/M = $5 + $12.50 = $17.50
    expect(estimateCost('opus', 1_000_000, 500_000)).toBeCloseTo(17.5);
  });

  test('calculates sonnet cost correctly', () => {
    // 1M input * $3/M + 1M output * $15/M = $3 + $15 = $18
    expect(estimateCost('sonnet', 1_000_000, 1_000_000)).toBeCloseTo(18);
  });

  test('calculates haiku cost correctly', () => {
    // 2M input * $1/M + 1M output * $5/M = $2 + $5 = $7
    expect(estimateCost('haiku', 2_000_000, 1_000_000)).toBeCloseTo(7);
  });

  test('matches model names with version suffixes', () => {
    expect(estimateCost('claude-sonnet-4-20250514', 1_000_000, 0)).toBeCloseTo(3);
    expect(estimateCost('claude-opus-4-20250514', 1_000_000, 0)).toBeCloseTo(5);
    expect(estimateCost('claude-haiku-4-5-20251001', 1_000_000, 0)).toBeCloseTo(1);
  });

  test('returns null for unknown model', () => {
    expect(estimateCost('gpt-4o', 1_000_000, 1_000_000)).toBeNull();
  });

  test('returns null for null model', () => {
    expect(estimateCost(null, 1_000_000, 1_000_000)).toBeNull();
  });

  test('handles zero tokens', () => {
    expect(estimateCost('sonnet', 0, 0)).toBeCloseTo(0);
  });
});
