import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

const menuOptions: SelectOption[] = [
  { name: 'List', description: 'View all configured rules' },
  { name: 'Create', description: 'Create a new rule from a target and intent' },
  { name: 'Generate', description: 'Auto-generate rules from your codebase' },
  { name: 'Validate', description: 'Check all rules for errors' },
];

export function RulesHubScreen() {
  const { navigate, goHome } = useRouter();

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  const handleSelect = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    switch (option.name) {
      case 'List':
        navigate({ screen: 'rules-list' });
        break;
      case 'Create':
        navigate({ screen: 'rules-create' });
        break;
      case 'Generate':
        navigate({ screen: 'rules-generate' });
        break;
      case 'Validate':
        navigate({ screen: 'rules-validate' });
        break;
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.accent}>Rules</text>
      </box>

      <box flexDirection="column" paddingLeft={2} flexGrow={1}>
        <select focused flexGrow={1} options={menuOptions} {...selectColors} onSelect={handleSelect} />
      </box>

      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.textDim}>↑↓ navigate · enter select · ESC back</text>
      </box>
    </box>
  );
}
