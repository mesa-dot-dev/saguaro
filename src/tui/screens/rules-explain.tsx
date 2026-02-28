import type { RulePolicy } from '@mesa/code-review';
import { explainRuleAdapter } from '@mesa/code-review';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { useRouter } from '../lib/router.js';
import { theme } from '../lib/theme.js';

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

export function RulesExplainScreen({ ruleId }: { ruleId: string }) {
  const { navigate } = useRouter();
  const [rule, setRule] = useState<RulePolicy | null>(null);
  const [notFound, setNotFound] = useState(false);

  useKeyboard((e) => {
    if (e.name === 'escape') {
      navigate({ screen: 'rules-list' });
    }
    if (e.name === 'd') {
      navigate({ screen: 'rules-delete', ruleId });
    }
  });

  useEffect(() => {
    const result = explainRuleAdapter({ ruleId });
    if (result.rule) {
      setRule(result.rule);
    } else {
      setNotFound(true);
    }
  }, [ruleId]);

  if (notFound) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.error}>Rule not found: {ruleId}</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back to list</text>
        </box>
      </box>
    );
  }

  if (!rule) {
    return (
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.textDim}>Loading...</text>
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>{rule.id}</text>
      </box>

      <scrollbox focused flexGrow={1} paddingLeft={2} paddingTop={1}>
        <box flexDirection="column">
          <text fg={theme.text}>Title: {rule.title}</text>
          <text fg={severityColor(rule.severity)}>Severity: {rule.severity}</text>
          <text fg={theme.text}>Globs: {rule.globs.join(', ')}</text>

          <box paddingTop={1}>
            <text fg={theme.textDim}>Instructions:</text>
          </box>
          <text fg={theme.text}>{rule.instructions}</text>

          {rule.examples?.violations && rule.examples.violations.length > 0 && (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.error}>Violation patterns:</text>
              {rule.examples.violations.map((v, i) => (
                <text key={`v-${i}`} fg={theme.textDim}>
                  {'  '}- {v}
                </text>
              ))}
            </box>
          )}

          {rule.examples?.compliant && rule.examples.compliant.length > 0 && (
            <box flexDirection="column" paddingTop={1}>
              <text fg={theme.success}>Compliant patterns:</text>
              {rule.examples.compliant.map((c, i) => (
                <text key={`c-${i}`} fg={theme.textDim}>
                  {'  '}- {c}
                </text>
              ))}
            </box>
          )}
        </box>
      </scrollbox>

      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.textDim}>↑↓ scroll · d delete · ESC back to list</text>
      </box>
    </box>
  );
}
