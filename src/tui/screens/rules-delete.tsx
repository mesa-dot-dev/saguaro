import type { RulePolicy } from '@mesa/code-review';
import { deleteRuleAdapter, explainRuleAdapter } from '@mesa/code-review';
import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

type DeleteStep =
  | { step: 'confirm'; rule: RulePolicy }
  | { step: 'not-found' }
  | { step: 'done' }
  | { step: 'loading' };

export function RulesDeleteScreen({ ruleId }: { ruleId: string }) {
  const { navigate } = useRouter();
  const [state, setState] = useState<DeleteStep>({ step: 'loading' });

  useKeyboard((e) => {
    if (e.name === 'escape') {
      navigate({ screen: 'rules-list' });
    }
  });

  useEffect(() => {
    const result = explainRuleAdapter({ ruleId });
    if (result.rule) {
      setState({ step: 'confirm', rule: result.rule });
    } else {
      setState({ step: 'not-found' });
    }
  }, [ruleId]);

  if (state.step === 'loading') {
    return (
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.textDim}>Loading...</text>
      </box>
    );
  }

  if (state.step === 'not-found') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.error}>Rule not found: {ruleId}</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back to list</text>
        </box>
      </box>
    );
  }

  if (state.step === 'done') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.success}>Rule deleted: {ruleId}</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back to list</text>
        </box>
      </box>
    );
  }

  const { rule } = state;
  const options: SelectOption[] = [
    { name: 'Yes', description: 'Delete this rule permanently' },
    { name: 'No', description: 'Cancel and go back' },
  ];

  const handleSelect = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    if (option.name === 'Yes') {
      deleteRuleAdapter({ ruleId });
      setState({ step: 'done' });
    } else {
      navigate({ screen: 'rules-list' });
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box flexDirection="column" paddingLeft={2} paddingTop={1} flexGrow={1} flexShrink={1}>
        <text fg={theme.accent}>Delete Rule</text>
        <box paddingTop={1}>
          <text fg={theme.text}>
            {rule.id} — {rule.title}
          </text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.warning}>Are you sure you want to delete this rule?</text>
        </box>
      </box>
      <box flexDirection="column" paddingLeft={2} flexShrink={0} minHeight={5}>
        <select focused flexGrow={1} options={options} {...selectColors} onSelect={handleSelect} />
      </box>
      <box paddingLeft={2} paddingBottom={1} flexShrink={0}>
        <text fg={theme.textDim}>↑↓ navigate · enter select · ESC back</text>
      </box>
    </box>
  );
}
