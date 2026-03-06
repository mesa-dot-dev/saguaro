import type { RulePolicy } from '../../types/types.js';
import { listRulesAdapter } from '../../adapter/rules.js';
import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

export function RulesListScreen() {
  const { navigate, goHome } = useRouter();
  const [rules, setRules] = useState<RulePolicy[]>([]);
  const [loaded, setLoaded] = useState(false);

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  useEffect(() => {
    const result = listRulesAdapter();
    setRules(result.rules);
    setLoaded(true);
  }, []);

  if (!loaded) {
    return (
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.textDim}>Loading rules...</text>
      </box>
    );
  }

  if (rules.length === 0) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Rules</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>No rules found. Use /rules create or /rules generate to add rules.</text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back</text>
        </box>
      </box>
    );
  }

  const options: SelectOption[] = rules.map((r) => ({
    name: `[${r.severity}] ${r.id} — ${r.title}`,
    description: r.id,
  }));

  const handleSelect = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    navigate({ screen: 'rules-explain', ruleId: option.description });
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.accent}>Rules ({rules.length})</text>
      </box>

      <box flexDirection="column" paddingLeft={2} flexGrow={1} flexShrink={0} minHeight={5}>
        <select focused flexGrow={1} options={options} {...selectColors} onSelect={handleSelect} />
      </box>

      <box paddingLeft={2} paddingBottom={1} flexShrink={0}>
        <text fg={theme.textDim}>↑↓ navigate · enter explain · ESC back</text>
      </box>
    </box>
  );
}
