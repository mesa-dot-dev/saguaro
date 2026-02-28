import type { ModelOptions } from '@mesa/code-review';
import { getModelOptions, hasApiKey, switchModel } from '@mesa/code-review';
import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { Spinner } from '../components/spinner.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

type ProviderInfo = ModelOptions['catalog'][number];
type CurrentModelInfo = ModelOptions['currentModel'];

type ModelStep =
  | { step: 'loading' }
  | { step: 'provider'; currentModel: CurrentModelInfo; catalog: ProviderInfo[] }
  | { step: 'model'; currentModel: CurrentModelInfo; provider: ProviderInfo }
  | { step: 'api-key'; currentModel: CurrentModelInfo; provider: ProviderInfo; model: string }
  | { step: 'done'; previous: string | null; current: string; keyUpdated: boolean }
  | { step: 'error'; message: string };

export function ModelScreen() {
  const { goHome } = useRouter();
  const [state, setState] = useState<ModelStep>({ step: 'loading' });
  const [inputValue, setInputValue] = useState('');

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  useEffect(() => {
    void getModelOptions()
      .then(({ currentModel, catalog }) => {
        setState({ step: 'provider', currentModel, catalog });
      })
      .catch((err) => {
        setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  if (state.step === 'loading') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <Spinner label="Loading model catalog..." />
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
    const { currentModel, catalog } = state;
    const options: SelectOption[] = catalog.map((p) => ({
      name: p.label,
      description: p.id,
      value: p.id,
    }));

    const handleSelect = (_index: number, option: SelectOption | null) => {
      if (!option) return;
      const provider = catalog.find((p) => p.id === option.value);
      if (provider) {
        setState({ step: 'model', currentModel, provider });
      }
    };

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box paddingLeft={2} paddingTop={1} flexDirection="column">
          <text fg={theme.accent}>Model</text>
          {currentModel && (
            <text fg={theme.textDim}>
              Current: {currentModel.provider} / {currentModel.model}
            </text>
          )}
        </box>

        <box paddingLeft={2} paddingTop={1}>
          <text fg={theme.text}>Select provider:</text>
        </box>

        <box flexDirection="column" paddingLeft={2} flexGrow={1}>
          <select focused flexGrow={1} options={options} {...selectColors} onSelect={handleSelect} />
        </box>

        <box paddingLeft={2} paddingBottom={1}>
          <text fg={theme.textDim}>↑↓ navigate · enter select · ESC back</text>
        </box>
      </box>
    );
  }

  if (state.step === 'model') {
    const { currentModel, provider } = state;
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
        setState({ step: 'api-key', currentModel, provider, model: '' });
        return;
      }
      const modelId = option.value as string;
      if (hasApiKey(provider.id)) {
        const result = switchModel({ provider: provider.id, model: modelId });
        setState({ step: 'done', previous: result.previousModel, current: result.newModel, keyUpdated: false });
      } else {
        setState({ step: 'api-key', currentModel, provider, model: modelId });
      }
    };

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box paddingLeft={2} paddingTop={1} flexDirection="column">
          <text fg={theme.accent}>Model — {provider.label}</text>
        </box>

        <box paddingLeft={2} paddingTop={1}>
          <text fg={theme.text}>Select model:</text>
        </box>

        <box flexDirection="column" paddingLeft={2} flexGrow={1}>
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
          <text fg={theme.textDim}>↑↓ navigate · enter select · ESC back</text>
        </box>
      </box>
    );
  }

  if (state.step === 'api-key') {
    const { currentModel, provider, model } = state;
    const needsModelName = model === '';

    const handleSubmit = () => {
      const val = inputValue.trim();
      if (needsModelName) {
        if (!val) return;
        // Now we have the custom model name, check api key
        if (hasApiKey(provider.id)) {
          const result = switchModel({ provider: provider.id, model: val });
          setState({ step: 'done', previous: result.previousModel, current: result.newModel, keyUpdated: false });
        } else {
          setInputValue('');
          setState({ step: 'api-key', currentModel, provider, model: val });
        }
        return;
      }
      // val is the API key (or empty to skip)
      const apiKey = val.toLowerCase() === 'n' || val === '' ? undefined : val;
      const result = switchModel({ provider: provider.id, model, apiKey });
      setState({
        step: 'done',
        previous: result.previousModel,
        current: result.newModel,
        keyUpdated: result.keyUpdated,
      });
    };

    const label = needsModelName
      ? 'Enter custom model name:'
      : `Paste your ${provider.envKey} (or press Enter to skip):`;

    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Model — {provider.label}</text>
        {!needsModelName && <text fg={theme.textDim}>Model: {model}</text>}
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
          <text fg={theme.textDim}>Enter to submit · ESC back</text>
        </box>
      </box>
    );
  }

  // done
  const { previous, current, keyUpdated } = state;
  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <text fg={theme.success}>Model updated</text>
      {previous && <text fg={theme.textDim}>Previous: {previous}</text>}
      <text fg={theme.text}>Current: {current}</text>
      {keyUpdated && <text fg={theme.textDim}>API key saved to .env.local</text>}
      <box paddingTop={1}>
        <text fg={theme.textDim}>ESC back to home</text>
      </box>
    </box>
  );
}
