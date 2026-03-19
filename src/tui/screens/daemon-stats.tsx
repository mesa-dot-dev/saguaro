import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import type { DaemonFinding, DaemonStatsResult, TimeWindow } from '../../adapter/daemon-stats.js';
import { getDaemonFindings, getDaemonStats } from '../../adapter/daemon-stats.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

const TIME_RANGES: SelectOption[] = [
  { name: '1h', description: 'Last hour' },
  { name: '1d', description: 'Last 24h' },
  { name: '7d', description: 'Last 7 days' },
  { name: '30d', description: 'Last 30 days' },
  { name: 'all', description: 'All time' },
];

const SEVERITY_OPTIONS: SelectOption[] = [
  { name: 'All', description: 'All severities' },
  { name: 'error', description: 'Errors only' },
  { name: 'warning', description: 'Warnings only' },
];

function buildRepoOptions(result: DaemonStatsResult): SelectOption[] {
  return [
    { name: 'All', description: 'All repos' },
    ...result.stats.byRepo.map((r) => ({
      name: r.repo,
      description: `${r.reviews} reviews, ${r.findings} findings`,
    })),
  ];
}

function buildCategoryOptions(result: DaemonStatsResult): SelectOption[] {
  return [
    { name: 'All', description: 'All categories' },
    ...result.stats.byCategory.map((c) => ({
      name: c.category,
      description: `${c.count} findings`,
    })),
  ];
}

function severityColor(severity: 'error' | 'warning'): string {
  return severity === 'error' ? theme.error : theme.warning;
}

function truncateMessage(message: string, maxLines: number): string {
  const lines = message.split('\n');
  if (lines.length <= maxLines) return message;
  return `${lines.slice(0, maxLines).join('\n')}...`;
}

export function DaemonStatsScreen() {
  const { goHome } = useRouter();
  const [window, setWindow] = useState<TimeWindow>('7d');
  const [result, setResult] = useState<DaemonStatsResult | null>(null);
  const [findings, setFindings] = useState<DaemonFinding[]>([]);
  const [repoFilter, setRepoFilter] = useState<string | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [severityFilter, setSeverityFilter] = useState<string | undefined>(undefined);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  useEffect(() => {
    const stats = getDaemonStats(window);
    setResult(stats);

    const filters: { repo?: string; category?: string; severity?: 'error' | 'warning' } = {};
    if (repoFilter) filters.repo = repoFilter;
    if (categoryFilter) filters.category = categoryFilter;
    if (severityFilter === 'error' || severityFilter === 'warning') filters.severity = severityFilter;

    const f = getDaemonFindings(window, Object.keys(filters).length > 0 ? filters : undefined);
    setFindings(f);
    setExpandedIndex(null);
  }, [window, repoFilter, categoryFilter, severityFilter]);

  const handleTimeRange = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    setWindow(option.name as TimeWindow);
  };

  const handleRepoFilter = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    setRepoFilter(option.name === 'All' ? undefined : option.name);
  };

  const handleCategoryFilter = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    setCategoryFilter(option.name === 'All' ? undefined : option.name);
  };

  const handleSeverityFilter = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    setSeverityFilter(option.name === 'All' ? undefined : option.name);
  };

  const handleFindingSelect = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
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
          <text fg={theme.textDim}>
            No daemon reviews found. The daemon runs automatically during coding sessions.
          </text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back</text>
        </box>
      </box>
    );
  }

  const { stats } = result;
  const { overview, cost } = stats;
  const hitRateStr = `${overview.hitRate}%`;
  const costStr = cost !== null ? `  $${cost.totalCostUsd.toFixed(2)}` : '';
  const summaryLine = `${overview.totalReviews} reviews  ${overview.findings} findings  ${hitRateStr} hit rate${costStr}  avg ${overview.avgDurationSecs}s`;

  const repoOptions = buildRepoOptions(result);
  const categoryOptions = buildCategoryOptions(result);

  return (
    <box flexDirection="column" width="100%" height="100%">
      {/* Header */}
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Daemon Stats ({window})</text>
      </box>

      {/* Stats summary */}
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.text}>{summaryLine}</text>
      </box>

      {/* Filter row */}
      <box paddingLeft={2} paddingTop={1} flexDirection="row" gap={2}>
        <tab-select options={repoOptions} {...selectColors} onSelect={handleRepoFilter} />
        <tab-select options={categoryOptions} {...selectColors} onSelect={handleCategoryFilter} />
        <tab-select options={SEVERITY_OPTIONS} {...selectColors} onSelect={handleSeverityFilter} />
      </box>

      {/* Findings list */}
      <scrollbox focused flexGrow={1} paddingLeft={2} paddingTop={1}>
        <box flexDirection="column">
          {findings.length === 0 ? (
            <text fg={theme.textDim}>No findings match the current filters.</text>
          ) : (
            findings.map((finding, i) => {
              const isExpanded = expandedIndex === i;
              const locationStr = finding.line !== null ? `${finding.file}:${finding.line}` : finding.file;
              const msg = isExpanded ? finding.message : truncateMessage(finding.message, 2);

              return (
                <box
                  key={`${finding.file}-${finding.line}-${i}`}
                  flexDirection="column"
                  paddingBottom={1}
                >
                  <text fg={severityColor(finding.severity)}>
                    [{finding.severity}] {locationStr}
                  </text>
                  <text fg={theme.textDim}>  {msg}</text>
                </box>
              );
            })
          )}
        </box>
      </scrollbox>

      {/* Footer with time range selector and help */}
      <box paddingLeft={2} paddingBottom={1} flexDirection="row" gap={2}>
        <tab-select focused options={TIME_RANGES} {...selectColors} onSelect={handleTimeRange} />
      </box>
      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.textDim}>enter expand  tab cycle filters  ESC back</text>
      </box>
    </box>
  );
}
