// src/adapter/daemon-stats.ts

import type {
  DaemonFinding,
  DaemonFindingsFilter,
  DaemonStatsAggregation,
  TimeWindow,
} from '../daemon/stats-types.js';
import { DaemonStore } from '../daemon/store.js';

export type { DaemonFinding, DaemonFindingsFilter, TimeWindow };

export interface DaemonStatsResult {
  stats: DaemonStatsAggregation;
  empty: boolean;
}

export function getDaemonStats(window: TimeWindow = '7d'): DaemonStatsResult {
  const store = new DaemonStore();
  try {
    const stats = store.getStats(window);
    return { stats, empty: stats.overview.totalReviews === 0 };
  } finally {
    store.close();
  }
}

export function getDaemonFindings(window: TimeWindow = '7d', filters?: DaemonFindingsFilter): DaemonFinding[] {
  const store = new DaemonStore();
  try {
    return store.getRecentFindings(window, filters);
  } finally {
    store.close();
  }
}
