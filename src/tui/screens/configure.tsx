import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import type { Route } from '../lib/router.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

const menuOptions: (SelectOption & { route: Route })[] = [
  { name: 'Index', description: 'Build the codebase import graph', route: { screen: 'index' } },
  { name: 'Hooks', description: 'Manage Claude Code hooks', route: { screen: 'hook' } },
  { name: 'Init', description: 'Set up Saguaro in your repo', route: { screen: 'init' } },
];

export function ConfigureScreen() {
  const { navigate, goHome } = useRouter();

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  const handleSelect = (index: number, _option: SelectOption | null) => {
    const entry = menuOptions[index];
    if (entry) navigate(entry.route);
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.accent}>Configure</text>
      </box>

      <box flexDirection="column" paddingLeft={2} flexGrow={1} flexShrink={0} minHeight={7}>
        <select focused flexGrow={1} options={menuOptions} {...selectColors} onSelect={handleSelect} />
      </box>

      <box paddingLeft={2} paddingBottom={1} flexShrink={0}>
        <text fg={theme.textDim}>↑↓ navigate · enter select · ESC back</text>
      </box>
    </box>
  );
}
