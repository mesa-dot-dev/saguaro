import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import type { StatsResult } from '../../adapter/stats.js';
import { getStats } from '../../adapter/stats.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

const TIME_RANGES: SelectOption[] = [
  { name: '7', description: 'Last 7 days' },
  { name: '30', description: 'Last 30 days' },
  { name: 'all', description: 'All time' },
];

export function StatsScreen() {
  const { goHome } = useRouter();
  const [days, setDays] = useState<number | undefined>(undefined);
  const [result, setResult] = useState<StatsResult | null>(null);

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  useEffect(() => {
    setResult(getStats({ days }));
  }, [days]);

  const handleTimeRange = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    setDays(option.name === 'all' ? undefined : Number(option.name));
  };

  if (!result) {
    return (
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.textDim}>Loading stats...</text>
      </box>
    );
  }

  if (result.empty) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Stats</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>
            {result.entryCount === 0
              ? 'No review history found. Run a review to start collecting data.'
              : `No reviews in the last ${days} day(s).`}
          </text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back</text>
        </box>
      </box>
    );
  }

  const { stats } = result;
  const { overview, costAndTokens, modelBreakdown, violations, topTriggeredRules } = stats;
  const reviewsPerDay = overview.total > 0 ? (overview.total / overview.daySpan).toFixed(1) : '0';

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Stats</text>
      </box>

      <scrollbox focused flexGrow={1} paddingLeft={2} paddingTop={1}>
        <box flexDirection="column">
          {/* Overview */}
          <text fg={theme.accent}>OVERVIEW</text>
          <text fg={theme.text}>Total reviews: {overview.total}</text>
          <text fg={theme.text}>
            Sources: {overview.bySource.cli} cli, {overview.bySource.hook} hook, {overview.bySource.mcp} mcp
          </text>
          <text fg={theme.text}>Time span: {overview.daySpan} day(s)</text>
          <text fg={theme.text}>Reviews/day: {reviewsPerDay}</text>

          {/* Cost */}
          <box paddingTop={1}>
            <text fg={theme.accent}>COST & TOKENS</text>
          </box>
          <text fg={theme.text}>Total cost: ${costAndTokens.totalCost.toFixed(2)}</text>
          <text fg={theme.text}>Avg cost: ${(costAndTokens.totalCost / overview.total).toFixed(3)}/review</text>
          <text fg={theme.text}>Input tokens: {costAndTokens.totalInputTokens.toLocaleString()}</text>
          <text fg={theme.text}>Output tokens: {costAndTokens.totalOutputTokens.toLocaleString()}</text>
          <text fg={theme.text}>Files reviewed: {costAndTokens.totalFilesReviewed}</text>

          {/* Models */}
          {modelBreakdown.length > 0 && (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.accent}>MODEL BREAKDOWN</text>
              {modelBreakdown.map((m) => (
                <text key={m.model} fg={theme.text}>
                  {m.model.padEnd(25)} {m.count} reviews ${m.totalCost.toFixed(2)}
                </text>
              ))}
            </box>
          )}

          {/* Violations */}
          <box paddingTop={1}>
            <text fg={theme.accent}>VIOLATIONS</text>
          </box>
          <text fg={theme.text}>Total: {violations.total}</text>
          <text fg={theme.error}>Errors: {violations.errors}</text>
          <text fg={theme.warning}>Warnings: {violations.warnings}</text>
          <text fg={theme.info}>Infos: {violations.infos}</text>
          <text fg={theme.text}>
            Clean reviews: {violations.cleanReviews}/{overview.total} (
            {overview.total > 0 ? ((violations.cleanReviews / overview.total) * 100).toFixed(0) : 0}%)
          </text>

          {/* Top rules */}
          {topTriggeredRules.length > 0 && (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.accent}>TOP TRIGGERED RULES</text>
              {topTriggeredRules.slice(0, 10).map((r) => (
                <text key={r.ruleId} fg={theme.text}>
                  {r.ruleId.padEnd(30)} {r.count}
                </text>
              ))}
            </box>
          )}
        </box>
      </scrollbox>

      <box paddingLeft={2} paddingBottom={1} flexDirection="row" gap={2}>
        <tab-select focused options={TIME_RANGES} {...selectColors} onSelect={handleTimeRange} />
      </box>
    </box>
  );
}
