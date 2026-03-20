import type { DaemonStatsAggregation } from '../../../adapter/daemon-stats.js';
import { BarChart } from '../../components/bar-chart.js';
import { theme } from '../../lib/theme.js';

interface CostTabProps {
  stats: DaemonStatsAggregation;
}

export function CostTab({ stats }: CostTabProps) {
  const { cost, byModel } = stats;

  if (!cost) {
    return (
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.textDim}>No cost data recorded yet. Cost tracking requires an agent that reports usage.</text>
      </box>
    );
  }

  return (
    <scrollbox flexGrow={1} paddingLeft={2} paddingTop={1}>
      <box flexDirection="column">
        {/* Spend */}
        <text fg={theme.accent}>SPEND</text>
        <text fg={theme.text}>Total Cost        ${cost.totalCostUsd.toFixed(2)}</text>
        <text fg={theme.text}>Avg / Review      ${cost.avgCostPerReview.toFixed(3)}</text>
        <text fg={theme.text}>Reviews w/ Data   {cost.reviewsWithCostData}</text>

        {/* Tokens */}
        <box paddingTop={1}>
          <text fg={theme.accent}>TOKENS</text>
        </box>
        <text fg={theme.text}>Input             {cost.totalInputTokens.toLocaleString()}</text>
        <text fg={theme.text}>Output            {cost.totalOutputTokens.toLocaleString()}</text>
        <text fg={theme.text}>Total             {(cost.totalInputTokens + cost.totalOutputTokens).toLocaleString()}</text>

        {/* Cost by Model */}
        {byModel.length > 0 && (
          <box flexDirection="column" paddingTop={1}>
            <text fg={theme.accent}>COST BY MODEL</text>
            <box paddingTop={1}>
              <BarChart
                items={byModel.map((m) => ({
                  label: m.model,
                  value: m.count,
                  suffix: `$${m.costUsd.toFixed(2)}  (${m.count} reviews)`,
                }))}
              />
            </box>
          </box>
        )}
      </box>
    </scrollbox>
  );
}
