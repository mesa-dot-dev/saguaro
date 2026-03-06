import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import type { HookAction } from '../../adapter/hook.js';
import { runInstallHook, runUninstallHook } from '../../adapter/hook.js';
import { Spinner } from '../components/spinner.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

type HookState =
  | { phase: 'choose' }
  | { phase: 'running'; action: HookAction }
  | { phase: 'done'; action: HookAction }
  | { phase: 'error'; message: string };

interface HookScreenProps {
  action?: HookAction;
}

export function HookScreen({ action }: HookScreenProps) {
  const { goHome } = useRouter();
  const [state, setState] = useState<HookState>(action ? { phase: 'running', action } : { phase: 'choose' });
  const activeAction = state.phase === 'running' || state.phase === 'done' ? state.action : undefined;

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  useEffect(() => {
    if (state.phase !== 'running' || !activeAction) return;

    const run = activeAction === 'install' ? runInstallHook : runUninstallHook;
    void run()
      .then(() => {
        setState({ phase: 'done', action: activeAction });
      })
      .catch((err) => {
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }, [state.phase, activeAction]);

  if (state.phase === 'error') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.error}>Error: {state.message}</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Press ESC to go back</text>
        </box>
      </box>
    );
  }

  if (state.phase === 'done') {
    const verb = state.action === 'install' ? 'installed' : 'uninstalled';
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.success}>Hooks {verb} successfully.</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Press ESC to go back</text>
        </box>
      </box>
    );
  }

  if (state.phase === 'running') {
    const verb = state.action === 'install' ? 'Installing' : 'Uninstalling';
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Hooks</text>
        <box paddingTop={1}>
          <Spinner label={`${verb} hooks...`} />
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Press ESC to go back</text>
        </box>
      </box>
    );
  }

  // choose phase
  const options: SelectOption[] = [
    { name: 'Install', description: 'Install Claude Code hooks' },
    { name: 'Uninstall', description: 'Remove Claude Code hooks' },
  ];

  const handleSelect = (index: number) => {
    const selected: HookAction = index === 0 ? 'install' : 'uninstall';
    setState({ phase: 'running', action: selected });
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Hooks</text>
      </box>
      <box flexDirection="column" paddingLeft={2} paddingTop={1} flexGrow={1} flexShrink={0} minHeight={5}>
        <select focused flexGrow={1} options={options} {...selectColors} onSelect={handleSelect} />
      </box>
      <box paddingLeft={2} paddingBottom={1} flexShrink={0}>
        <text fg={theme.textDim}>↑↓ navigate · enter select · ESC cancel</text>
      </box>
    </box>
  );
}
