import type { DaemonStatsAggregation } from '../../../adapter/daemon-stats.js';
import { BarChart } from '../../components/bar-chart.js';
import { theme } from '../../lib/theme.js';

interface CostTabProps {
  stats: DaemonStatsAggregation;
}

export function CostTab({ stats }: CostTabProps) {
  const { cost, tokenUsage, byModel } = stats;

  if (!cost && !tokenUsage) {
    return (
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.textDim}>No cost data recorded yet. Cost tracking requires an agent that reports usage.</text>
      </box>
    );
  }

  return (
    <scrollbox flexGrow={1} paddingLeft={2} paddingTop={1}>
      <box flexDirection="column">
        {/* Spend — show actual cost if available */}
        {cost && (
          <box flexDirection="column">
            <text fg={theme.accent}>SPEND</text>
            <text fg={theme.text}>Total Cost        ${cost.totalCostUsd.toFixed(2)}</text>
            <text fg={theme.text}>Avg / Review      ${cost.avgCostPerReview.toFixed(3)}</text>
            <text fg={theme.text}>Reviews w/ Data   {cost.reviewsWithCostData}</text>
          </box>
        )}

        {/* Estimated cost for subscription users */}
        {!cost && tokenUsage && (
          <box flexDirection="column">
            <text fg={theme.accent}>ESTIMATED API COST</text>
            <text fg={theme.textDim}>Actual cost: $0.00 (included in subscription)</text>
            <text fg={theme.text}>API equivalent     ${tokenUsage.estimatedCostUsd.toFixed(2)}</text>
            <text fg={theme.text}>Reviews w/ Data    {tokenUsage.reviewsWithTokenData}</text>
          </box>
        )}

        {/* Tokens — show from whichever source has data */}
        {(() => {
          const tokens = cost ?? tokenUsage;
          if (!tokens) return null;
          return (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.accent}>TOKENS</text>
              <text fg={theme.text}>Input             {tokens.totalInputTokens.toLocaleString()}</text>
              <text fg={theme.text}>Output            {tokens.totalOutputTokens.toLocaleString()}</text>
              <text fg={theme.text}>Total             {(tokens.totalInputTokens + tokens.totalOutputTokens).toLocaleString()}</text>
            </box>
          );
        })()}

        {/* Cost by Model */}
        {byModel.length > 0 && (
          <box flexDirection="column" paddingTop={1}>
            <text fg={theme.accent}>{cost ? 'COST BY MODEL' : 'REVIEWS BY MODEL'}</text>
            <box paddingTop={1}>
              <BarChart
                items={byModel.map((m) => ({
                  label: m.model,
                  value: m.count,
                  suffix: cost ? `$${m.costUsd.toFixed(2)}  (${m.count} reviews)` : `${m.count} reviews`,
                }))}
              />
            </box>
          </box>
        )}
      </box>
    </scrollbox>
  );
}
