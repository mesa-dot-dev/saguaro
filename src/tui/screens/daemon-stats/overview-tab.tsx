import type { DaemonStatsAggregation } from '../../../adapter/daemon-stats.js';
import { BarChart } from '../../components/bar-chart.js';
import { theme } from '../../lib/theme.js';

interface OverviewTabProps {
  stats: DaemonStatsAggregation;
}

export function OverviewTab({ stats }: OverviewTabProps) {
  const { overview, byCategory, byRepo } = stats;

  return (
    <scrollbox flexGrow={1} paddingLeft={2} paddingTop={1}>
      <box flexDirection="column">
        {/* KPI Row */}
        <box flexDirection="row" gap={3}>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.textDim}>Reviews</text>
            <text fg={theme.text}>{overview.totalReviews}</text>
          </box>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.textDim}>Findings</text>
            <text fg={theme.text}>{overview.findings}</text>
          </box>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.textDim}>Hit Rate</text>
            <text fg={theme.text}>{overview.hitRate.toFixed(1)}%</text>
          </box>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.textDim}>Errors</text>
            <text fg={theme.error}>{overview.errors}</text>
          </box>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.textDim}>Warnings</text>
            <text fg={theme.warning}>{overview.warnings}</text>
          </box>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.textDim}>Failed</text>
            <text fg={theme.text}>{overview.failedJobs}</text>
          </box>
          <box flexDirection="column" alignItems="center">
            <text fg={theme.textDim}>Avg Time</text>
            <text fg={theme.text}>{overview.avgDurationSecs.toFixed(1)}s</text>
          </box>
        </box>

        {/* Findings by Category */}
        {byCategory.length > 0 && (
          <box flexDirection="column" paddingTop={2}>
            <text fg={theme.accent}>FINDINGS BY CATEGORY</text>
            <box paddingTop={1}>
              <BarChart items={byCategory.map((c) => ({ label: c.category, value: c.count }))} />
            </box>
          </box>
        )}

        {/* Reviews by Repo */}
        {byRepo.length > 0 && (
          <box flexDirection="column" paddingTop={2}>
            <text fg={theme.accent}>REVIEWS BY REPO</text>
            <box paddingTop={1}>
              <BarChart
                items={byRepo.map((r) => ({ label: r.repo, value: r.reviews, suffix: `(${r.findings} findings)` }))}
              />
            </box>
          </box>
        )}
      </box>
    </scrollbox>
  );
}
