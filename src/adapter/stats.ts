import type { StatsAggregation } from '../cli/lib/stats.js';
import { aggregateStats, filterByDays } from '../cli/lib/stats.js';
import { readReviewHistory } from '../lib/history.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatsOptions {
  days?: number;
}

export interface StatsResult {
  stats: StatsAggregation;
  entryCount: number;
  empty: boolean;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function getStats(options: StatsOptions = {}): StatsResult {
  const entries = readReviewHistory();

  if (entries.length === 0) {
    return {
      stats: aggregateStats([]),
      entryCount: 0,
      empty: true,
    };
  }

  const filtered = options.days ? filterByDays(entries, options.days) : entries;

  return {
    stats: aggregateStats(filtered),
    entryCount: filtered.length,
    empty: filtered.length === 0,
  };
}
