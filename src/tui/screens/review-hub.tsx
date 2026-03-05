import { getCurrentBranch, getDefaultBranch } from '@mesa/code-review';
import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useMemo, useState } from 'react';
import { useScreenInput } from '../lib/input-bar-context.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

type HubStep = { step: 'menu' } | { step: 'branch-input' };

export function ReviewHubScreen() {
  const { navigate, goHome } = useRouter();
  const [state, setState] = useState<HubStep>({ step: 'menu' });

  const currentBranch = useMemo(() => {
    try {
      return getCurrentBranch();
    } catch {
      return 'HEAD';
    }
  }, []);

  const defaultBranch = useMemo(() => {
    try {
      return getDefaultBranch();
    } catch {
      return 'main';
    }
  }, []);

  useKeyboard((e) => {
    if (e.name === 'escape') {
      if (state.step === 'branch-input') {
        setState({ step: 'menu' });
      } else {
        goHome();
      }
    }
  });

  const handleBranchSubmit = useMemo(
    () => (value: string) => {
      const base = value.trim() || defaultBranch;
      navigate({ screen: 'review', baseRef: base, headRef: currentBranch });
    },
    [currentBranch, defaultBranch, navigate]
  );

  const screenInputConfig = useMemo(() => {
    if (state.step !== 'branch-input') return null;
    return { placeholder: defaultBranch, onSubmit: handleBranchSubmit };
  }, [state.step, defaultBranch, handleBranchSubmit]);

  useScreenInput(screenInputConfig);

  if (state.step === 'branch-input') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Review Branch</text>
        <text fg={theme.textDim}>Head: {currentBranch}</text>
        <box paddingTop={1}>
          <text fg={theme.text}>Base branch to diff against:</text>
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Enter to submit · ESC back</text>
        </box>
      </box>
    );
  }

  const menuOptions: SelectOption[] = [
    { name: 'Rules', description: `Rules review on ${currentBranch} against ${defaultBranch}` },
    { name: 'Daemon', description: `Agentic staff-engineer review on ${currentBranch}` },
    { name: 'Full', description: `Run both rules + daemon reviews on ${currentBranch}` },
    { name: 'Branch', description: `Review ${currentBranch} against a specific base branch` },
    { name: 'Index', description: 'Build the codebase import graph' },
  ];

  const handleSelect = (_index: number, option: SelectOption | null) => {
    if (!option) return;
    switch (option.name) {
      case 'Rules':
        navigate({ screen: 'review', mode: 'rules' });
        break;
      case 'Daemon':
        navigate({ screen: 'review', mode: 'daemon' });
        break;
      case 'Full':
        navigate({ screen: 'review', mode: 'full' });
        break;
      case 'Branch':
        setState({ step: 'branch-input' });
        break;
      case 'Index':
        navigate({ screen: 'index' });
        break;
    }
  };

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.accent}>Review</text>
      </box>

      <box flexDirection="column" paddingLeft={2} flexGrow={1} flexShrink={0} minHeight={7}>
        <select focused flexGrow={1} options={menuOptions} {...selectColors} onSelect={handleSelect} />
      </box>

      <box paddingLeft={2} paddingBottom={1} flexShrink={0} flexDirection="column">
        <text fg={theme.textDim}>↑↓ navigate · enter select · ESC back</text>
        <text fg={theme.textDim}> </text>
        <text fg={theme.textDim}>Or enter slash commands:</text>
        <text fg={theme.textDim}> /review local Run rules review with defaults</text>
        <text fg={theme.textDim}> /review daemon Run agentic staff-engineer review</text>
        <text fg={theme.textDim}> /review full Run both rules + Mesa classic reviews</text>
        <text fg={theme.textDim}> /review branch --base main Review against a base branch</text>
        <text fg={theme.textDim}> /review index Build the import graph</text>
      </box>
    </box>
  );
}
