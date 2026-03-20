import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import type { DaemonFinding, DaemonStatsResult, TimeWindow } from '../../../adapter/daemon-stats.js';
import { getDaemonFindings } from '../../../adapter/daemon-stats.js';
import { theme } from '../../lib/theme.js';

const SEVERITY_OPTIONS: SelectOption[] = [
  { name: 'All', description: 'All severities' },
  { name: 'error', description: 'Errors only' },
  { name: 'warning', description: 'Warnings only' },
];

/** Local select colors — no orange background. */
const filterSelectColors = {
  textColor: theme.textDim,
  focusedBackgroundColor: 'transparent',
  focusedTextColor: theme.text,
  selectedBackgroundColor: 'transparent',
  selectedTextColor: theme.text,
} as const;

function buildRepoOptions(result: DaemonStatsResult): SelectOption[] {
  return [
    { name: 'All', description: 'All repos' },
    ...result.stats.byRepo.map((r) => ({
      name: r.repo,
      description: `${r.reviews} reviews`,
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

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(`${dateStr}Z`).getTime();
  const diffMs = Math.max(0, now - then);
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function truncateMessage(message: string, maxLines: number): string {
  const lines = message.split('\n');
  if (lines.length <= maxLines) return message;
  return `${lines.slice(0, maxLines).join('\n')}...`;
}

interface FindingsTabProps {
  result: DaemonStatsResult;
  timeWindow: TimeWindow;
  focused: boolean;
}

export function FindingsTab({ result, timeWindow, focused }: FindingsTabProps) {
  const [repoFilter, setRepoFilter] = useState<string | undefined>(undefined);
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined);
  const [severityFilter, setSeverityFilter] = useState<string | undefined>(undefined);
  const [findings, setFindings] = useState<DaemonFinding[]>([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Reset filters when time window changes
  useEffect(() => {
    setRepoFilter(undefined);
    setCategoryFilter(undefined);
    setSeverityFilter(undefined);
    setFocusedIndex(0);
    setExpandedIndex(null);
  }, [timeWindow]);

  // Fetch findings when filters change
  useEffect(() => {
    const filters: { repo?: string; category?: string; severity?: 'error' | 'warning' } = {};
    if (repoFilter) filters.repo = repoFilter;
    if (categoryFilter) filters.category = categoryFilter;
    if (severityFilter === 'error' || severityFilter === 'warning') filters.severity = severityFilter;

    const f = getDaemonFindings(timeWindow, Object.keys(filters).length > 0 ? filters : undefined);
    setFindings(f);
    setFocusedIndex(0);
    setExpandedIndex(null);
  }, [timeWindow, repoFilter, categoryFilter, severityFilter]);

  useKeyboard((e) => {
    if (!focused) return;
    if (findings.length === 0) return;

    if (e.name === 'up') {
      setFocusedIndex((i) => Math.max(0, i - 1));
    } else if (e.name === 'down') {
      setFocusedIndex((i) => Math.min(findings.length - 1, i + 1));
    } else if (e.name === 'return') {
      setExpandedIndex((prev) => (prev === focusedIndex ? null : focusedIndex));
    }
  });

  const repoOptions = buildRepoOptions(result);
  const categoryOptions = buildCategoryOptions(result);

  return (
    <box flexDirection="column" flexGrow={1}>
      {/* Filter bar */}
      <box paddingLeft={2} paddingTop={1} flexDirection="row" gap={2}>
        <tab-select
          options={repoOptions}
          {...filterSelectColors}
          onSelect={(_i: number, opt: SelectOption | null) => {
            if (opt) setRepoFilter(opt.name === 'All' ? undefined : opt.name);
          }}
        />
        <tab-select
          options={categoryOptions}
          {...filterSelectColors}
          onSelect={(_i: number, opt: SelectOption | null) => {
            if (opt) setCategoryFilter(opt.name === 'All' ? undefined : opt.name);
          }}
        />
        <tab-select
          options={SEVERITY_OPTIONS}
          {...filterSelectColors}
          onSelect={(_i: number, opt: SelectOption | null) => {
            if (opt) setSeverityFilter(opt.name === 'All' ? undefined : opt.name);
          }}
        />
        <text fg={theme.textDim}>{findings.length} results</text>
      </box>

      {/* Findings list */}
      <scrollbox flexGrow={1} paddingLeft={2} paddingTop={1}>
        <box flexDirection="column">
          {findings.length === 0 ? (
            <text fg={theme.textDim}>No findings match the current filters.</text>
          ) : (
            findings.map((finding, i) => {
              const isFocused = i === focusedIndex;
              const isExpanded = i === expandedIndex;
              const locationStr = finding.line !== null ? `${finding.file}:${finding.line}` : finding.file;
              const sevIcon = finding.severity === 'error' ? '\u25CF' : '\u25CB';
              const sevColor = finding.severity === 'error' ? theme.error : theme.warning;
              const sevLabel = finding.severity === 'error' ? 'error' : 'warn ';
              const cursor = isExpanded ? '\u25BC' : isFocused ? '\u25B8' : ' ';
              const msgColor = isFocused ? theme.text : theme.textDim;
              const msg = isExpanded ? finding.message : truncateMessage(finding.message, 2);
              const timeAgo = relativeTime(finding.createdAt);

              return (
                <box key={`${finding.file}-${finding.line}-${i}`} flexDirection="column" paddingBottom={1}>
                  <box flexDirection="row">
                    <text fg={isFocused ? theme.text : theme.textDim}>{cursor} </text>
                    <text fg={sevColor}>
                      {sevIcon} {sevLabel}
                    </text>
                    <text fg={theme.text}> {locationStr}</text>
                    <text fg={theme.textDim}> {timeAgo}</text>
                  </box>
                  <text fg={theme.textDim}> {finding.categories.join(', ')}</text>
                  <text fg={msgColor}> {msg}</text>

                  {isExpanded && (
                    <box flexDirection="column" paddingTop={1} paddingLeft={4}>
                      <text fg={theme.border}>
                        {'\u2500'.repeat(3)} Review Context {'\u2500'.repeat(23)}
                      </text>
                      <text fg={theme.textDim}>Repo: {finding.repoPath}</text>
                      <text fg={theme.textDim}>Model: {finding.model ?? 'unknown'}</text>
                      <text fg={theme.textDim}>
                        Job Cost: {finding.costUsd != null ? `$${finding.costUsd.toFixed(2)}` : '\u2014'}
                      </text>
                      <text fg={theme.textDim}>
                        Reviewed: {(finding.completedAt ?? finding.createdAt).slice(0, 16)} UTC
                      </text>
                    </box>
                  )}
                </box>
              );
            })
          )}
        </box>
      </scrollbox>
    </box>
  );
}
