import { useKeyboard } from '@opentui/react';
import type { ReviewResult, Violation } from '../../types/types.js';
import { useRouter } from '../lib/router.js';
import { theme } from '../lib/theme.js';

function severityIcon(severity: string): string {
  switch (severity) {
    case 'error':
      return '✗';
    case 'warning':
      return '⚠';
    default:
      return 'ℹ';
  }
}

function severityColor(severity: string): string {
  switch (severity) {
    case 'error':
      return theme.error;
    case 'warning':
      return theme.warning;
    default:
      return theme.info;
  }
}

function groupByRule(violations: Violation[]): Map<string, Violation[]> {
  const groups = new Map<string, Violation[]>();
  for (const v of violations) {
    const existing = groups.get(v.ruleId);
    if (existing) {
      existing.push(v);
    } else {
      groups.set(v.ruleId, [v]);
    }
  }
  return groups;
}

export function ReviewResultsScreen({ result }: { result: ReviewResult }) {
  const { goHome } = useRouter();

  useKeyboard((e) => {
    if (e.name === 'escape' || e.name === 'q') {
      goHome();
    }
  });

  const { violations } = result;
  const { filesReviewed, rulesChecked, errors, warnings, infos, durationMs } = result.summary;
  const duration = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : '?';

  if (violations.length === 0) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.success}>No rule violations found</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>
            {filesReviewed} files reviewed · {rulesChecked} rules checked · {duration}
          </text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Press ESC or q to go back</text>
        </box>
      </box>
    );
  }

  const groups = groupByRule(violations);

  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1} width="100%" height="100%">
      <text fg={theme.accent}>Review Results</text>

      <scrollbox focused flexGrow={1} paddingTop={1}>
        <box flexDirection="column">
          {Array.from(groups.entries()).map(([ruleId, ruleViolations]) => {
            const severity = ruleViolations[0].severity;
            const icon = severityIcon(severity);
            const color = severityColor(severity);

            return (
              <box key={ruleId} flexDirection="column" paddingBottom={1}>
                <text fg={color}>
                  {icon} {ruleId} [{severity}]
                  {ruleViolations.length > 1 ? ` — ${ruleViolations.length} violations` : ''}
                </text>
                {ruleViolations.map((v, i) => {
                  const lineInfo = v.line ? `:${v.line}` : '';
                  return (
                    <text key={`${ruleId}-${i}`} fg={theme.textDim}>
                      {'  '}
                      {v.file}
                      {lineInfo} — {v.message}
                    </text>
                  );
                })}
              </box>
            );
          })}
        </box>
      </scrollbox>

      <box paddingTop={1} paddingBottom={1}>
        <text fg={theme.textDim}>
          {violations.length} violation(s): {errors} errors, {warnings} warnings, {infos} infos · {filesReviewed} files
          · {duration}
        </text>
      </box>
      <box>
        <text fg={theme.textDim}>↑↓ scroll · ESC/q go back</text>
      </box>
    </box>
  );
}
