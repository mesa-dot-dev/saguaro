import { useKeyboard } from '@opentui/react';
import { commands } from '../lib/commands.js';
import { useRouter } from '../lib/router.js';
import { theme } from '../lib/theme.js';

const categories = [
  { id: 'review', label: 'Review' },
  { id: 'rules', label: 'Rules' },
  { id: 'config', label: 'Config' },
  { id: 'system', label: 'System' },
] as const;

export function HelpScreen() {
  const { goHome } = useRouter();

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Help — Commands</text>
      </box>

      <scrollbox focused flexGrow={1} paddingLeft={2} paddingTop={1}>
        <box flexDirection="column">
          {categories.map((cat) => {
            const cmds = commands.filter((c) => c.category === cat.id);
            if (cmds.length === 0) return null;
            return (
              <box key={cat.id} flexDirection="column" paddingBottom={1}>
                <text fg={theme.accent}>{cat.label}</text>
                {cmds.map((cmd) => (
                  <text key={cmd.name} fg={theme.text}>
                    {'  '}
                    {`/${cmd.name.padEnd(20)}`} {cmd.description}
                  </text>
                ))}
              </box>
            );
          })}

          <box flexDirection="column" paddingTop={1}>
            <text fg={theme.accent}>Keybindings</text>
            <text fg={theme.text}>
              {'  '}/{''.padEnd(20)} Focus command bar
            </text>
            <text fg={theme.text}>
              {'  '}?{''.padEnd(20)} Show this help
            </text>
            <text fg={theme.text}>
              {'  '}ESC{''.padEnd(18)} Go back / home
            </text>
            <text fg={theme.text}>
              {'  '}q{''.padEnd(20)} Quit (from home)
            </text>
          </box>
        </box>
      </scrollbox>

      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.textDim}>↑↓ scroll · ESC back</text>
      </box>
    </box>
  );
}
