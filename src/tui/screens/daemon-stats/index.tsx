import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import type { DaemonStatsResult, TimeWindow } from '../../../adapter/daemon-stats.js';
import { getDaemonStats } from '../../../adapter/daemon-stats.js';
import { useInputBarContext } from '../../lib/input-bar-context.js';
import { useRouter } from '../../lib/router.js';
import { theme } from '../../lib/theme.js';
import { CostTab } from './cost-tab.js';
import { FindingsTab } from './findings-tab.js';
import { OverviewTab } from './overview-tab.js';

type Tab = 'overview' | 'findings' | 'cost';

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'findings', label: 'Findings' },
  { key: 'cost', label: 'Cost' },
];

const TIME_RANGES: SelectOption[] = [
  { name: '1h', description: 'Last hour' },
  { name: '1d', description: 'Last 24h' },
  { name: '7d', description: 'Last 7 days' },
  { name: '30d', description: 'Last 30 days' },
  { name: 'all', description: 'All time' },
];

/** Local select colors — no orange background. */
const timeSelectColors = {
  textColor: theme.textDim,
  focusedBackgroundColor: 'transparent',
  focusedTextColor: theme.text,
  selectedBackgroundColor: 'transparent',
  selectedTextColor: theme.text,
} as const;

export function DaemonStatsScreen() {
  const { goHome } = useRouter();
  const { screenInput } = useInputBarContext();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('7d');
  const [result, setResult] = useState<DaemonStatsResult | null>(null);

  useKeyboard((e) => {
    if (screenInput) return;
    if (e.name === 'escape') goHome();
    if (e.name === '1') setActiveTab('overview');
    if (e.name === '2') setActiveTab('findings');
    if (e.name === '3') setActiveTab('cost');
  });

  useEffect(() => {
    const stats = getDaemonStats(timeWindow);
    setResult(stats);
  }, [timeWindow]);

  const handleTimeRange = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    setTimeWindow(option.name as TimeWindow);
  };

  if (!result) {
    return (
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.textDim}>Loading daemon stats...</text>
      </box>
    );
  }

  if (result.empty) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Daemon Stats</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>No daemon reviews found. The daemon runs automatically during coding sessions.</text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back</text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Daemon Stats ({timeWindow})</text>
      </box>

      {/* Tab bar */}
      <box paddingLeft={2} paddingTop={1} flexDirection="row" gap={2}>
        {TAB_LABELS.map((t) => {
          const isActive = t.key === activeTab;
          const label = isActive ? `[ ${t.label} ]` : `  ${t.label}  `;
          return (
            <text key={t.key} fg={isActive ? theme.text : theme.textDim}>
              {label}
            </text>
          );
        })}
      </box>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab stats={result.stats} />}
      {activeTab === 'findings' && (
        <FindingsTab result={result} timeWindow={timeWindow} focused={activeTab === 'findings'} />
      )}
      {activeTab === 'cost' && <CostTab stats={result.stats} />}

      {/* Footer: time range + help */}
      <box paddingLeft={2} paddingBottom={1} flexDirection="row" gap={2}>
        <tab-select
          focused={activeTab !== 'findings'}
          options={TIME_RANGES}
          {...timeSelectColors}
          onSelect={handleTimeRange}
        />
      </box>
      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.textDim}>1/2/3 switch view · ↑↓ scroll · enter expand · ESC back</text>
      </box>
    </box>
  );
}
