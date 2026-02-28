import type { InitProjectResult, ModelOptions } from '@mesa/code-review';
import { getModelOptions, initProject } from '@mesa/code-review';
import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { Spinner } from '../components/spinner.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

type ProviderInfo = ModelOptions['catalog'][number];

type InitStep =
  | { step: 'loading' }
  | { step: 'provider'; catalog: ProviderInfo[] }
  | { step: 'model'; provider: ProviderInfo }
  | { step: 'api-key'; provider: ProviderInfo; model: string }
  | { step: 'rule-strategy'; provider: ProviderInfo; model: string; apiKey?: string }
  | { step: 'running' }
  | { step: 'done'; result: InitProjectResult; ruleStrategy: 'default' | 'generate' | 'skip' }
  | { step: 'error'; message: string };

export function InitScreen() {
  const { goHome } = useRouter();
  const [state, setState] = useState<InitStep>({ step: 'loading' });
  const [inputValue, setInputValue] = useState('');

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  useEffect(() => {
    void getModelOptions()
      .then(({ catalog }) => {
        setState({ step: 'provider', catalog });
      })
      .catch((err) => {
        setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  if (state.step === 'loading') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <Spinner label="Loading..." />
      </box>
    );
  }

  if (state.step === 'error') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.error}>Error: {state.message}</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back</text>
        </box>
      </box>
    );
  }

  if (state.step === 'provider') {
    const options: SelectOption[] = state.catalog.map((p) => ({
      name: p.label,
      description: p.id,
      value: p.id,
    }));

    const handleSelect = (_index: number, option: SelectOption | null) => {
      if (!option) return;
      const provider = state.catalog.find((p) => p.id === option.value);
      if (provider) setState({ step: 'model', provider });
    };

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box paddingLeft={2} paddingTop={1}>
          <text fg={theme.accent}>Init — Select Provider</text>
        </box>
        <box flexDirection="column" paddingLeft={2} paddingTop={1} flexGrow={1}>
          <select focused flexGrow={1} options={options} {...selectColors} onSelect={handleSelect} />
        </box>
        <box paddingLeft={2} paddingBottom={1}>
          <text fg={theme.textDim}>↑↓ navigate · enter select · ESC cancel</text>
        </box>
      </box>
    );
  }

  if (state.step === 'model') {
    const { provider } = state;
    const options: SelectOption[] = [
      ...provider.models.map((m) => ({
        name: m.recommended ? `${m.id} (recommended)` : m.id,
        description: m.label,
        value: m.id,
      })),
      { name: 'Enter a custom model name', description: 'Type a custom model ID', value: 'custom' },
    ];

    const handleSelect = (_index: number, option: SelectOption | null) => {
      if (!option) return;
      if (option.value === 'custom') {
        setInputValue('');
        setState({ step: 'api-key', provider, model: '' });
        return;
      }
      setState({ step: 'api-key', provider, model: option.value as string });
    };

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box paddingLeft={2} paddingTop={1}>
          <text fg={theme.accent}>Init — Select Model ({provider.label})</text>
        </box>
        <box flexDirection="column" paddingLeft={2} paddingTop={1} flexGrow={1}>
          <select
            focused
            flexGrow={1}
            options={options}
            showDescription={false}
            {...selectColors}
            onSelect={handleSelect}
          />
        </box>
        <box paddingLeft={2} paddingBottom={1}>
          <text fg={theme.textDim}>↑↓ navigate · enter select · ESC cancel</text>
        </box>
      </box>
    );
  }

  if (state.step === 'api-key') {
    const { provider, model } = state;
    const needsModelName = model === '';

    const handleSubmit = () => {
      const val = inputValue.trim();
      if (needsModelName) {
        if (!val) return;
        setInputValue('');
        setState({ step: 'api-key', provider, model: val });
        return;
      }
      const apiKey = val.toLowerCase() === 'n' || val === '' ? undefined : val;
      setInputValue('');
      setState({ step: 'rule-strategy', provider, model, apiKey });
    };

    const label = needsModelName
      ? 'Enter custom model name:'
      : `Paste your ${provider.envKey} (or press Enter to skip):`;

    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Init — {needsModelName ? 'Custom Model' : 'API Key'}</text>
        {!needsModelName && (
          <text fg={theme.textDim}>
            Model: {provider.label} / {model}
          </text>
        )}
        <box paddingTop={1}>
          <text fg={theme.text}>{label}</text>
        </box>
        <box paddingTop={1}>
          <input
            focused
            value={inputValue}
            textColor={theme.text}
            placeholderColor={theme.textDim}
            cursorColor={theme.accent}
            onInput={setInputValue}
            onSubmit={handleSubmit}
          />
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Enter to submit · ESC cancel</text>
        </box>
      </box>
    );
  }

  if (state.step === 'rule-strategy') {
    const { provider, model, apiKey } = state;
    const options: SelectOption[] = [
      { name: 'Generate rules from your codebase', description: 'generate' },
      { name: 'Use Mesa starter rules', description: 'default' },
      { name: 'Skip and create rules manually', description: 'skip' },
    ];

    const handleSelect = (_index: number, option: SelectOption | null) => {
      if (!option) return;
      const ruleStrategy = option.description as 'default' | 'generate' | 'skip';
      setState({ step: 'running' });

      void initProject({ provider: provider.id, model, apiKey, ruleStrategy, force: true })
        .then((result) => {
          setState({ step: 'done', result, ruleStrategy });
        })
        .catch((err) => {
          setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
        });
    };

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box paddingLeft={2} paddingTop={1}>
          <text fg={theme.accent}>Init — Rule Setup</text>
        </box>
        <box flexDirection="column" paddingLeft={2} paddingTop={1} flexGrow={1}>
          <select focused flexGrow={1} options={options} {...selectColors} onSelect={handleSelect} />
        </box>
        <box paddingLeft={2} paddingBottom={1}>
          <text fg={theme.textDim}>↑↓ navigate · enter select · ESC cancel</text>
        </box>
      </box>
    );
  }

  if (state.step === 'running') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <Spinner label="Initializing Mesa..." />
      </box>
    );
  }

  // done
  const { result, ruleStrategy } = state;

  if (result.alreadyInitialized) {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.warning}>Mesa is already initialized in this directory.</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back</text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.success}>Mesa initialized successfully!</text>
      </box>
      <scrollbox focused flexGrow={1} paddingLeft={2} paddingTop={1}>
        <box flexDirection="column">
          <text fg={theme.textDim}>Created: {result.configPath}</text>
          <text fg={theme.textDim}>Created: {result.mcpConfigPath}</text>
          <text fg={theme.textDim}>Created: {result.rulesDir}/</text>
          {result.skillsWritten.map((s) => (
            <text key={s} fg={theme.textDim}>
              Created: .claude/skills/{s}
            </text>
          ))}
          {result.hooksInstalled && <text fg={theme.textDim}>Updated: .claude/settings.json (hooks)</text>}
          {result.envUpdated && <text fg={theme.textDim}>Updated: .env.local (API key)</text>}
          {result.rulesCreated.length > 0 && (
            <text fg={theme.textDim}>Applied {result.rulesCreated.length} starter rule(s)</text>
          )}
        </box>
      </scrollbox>

      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.textDim}>
          {ruleStrategy === 'generate' ? 'Press Enter to generate rules · ESC back' : 'ESC back'}
        </text>
      </box>
    </box>
  );
}
