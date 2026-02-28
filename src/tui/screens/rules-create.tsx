import type { GenerateRuleAdapterResult, RulePolicy } from '@mesa/code-review';
import { createRuleAdapter, generateRuleAdapter } from '@mesa/code-review';
import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useState } from 'react';
import { Spinner } from '../components/spinner.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

type CreateStep =
  | { step: 'target' }
  | { step: 'intent'; target: string }
  | { step: 'generating'; target: string; intent: string }
  | { step: 'preview'; target: string; intent: string; result: GenerateRuleAdapterResult }
  | { step: 'done'; rule: RulePolicy }
  | { step: 'error'; message: string };

export function RulesCreateScreen() {
  const { navigate } = useRouter();
  const [state, setState] = useState<CreateStep>({ step: 'target' });
  const [inputValue, setInputValue] = useState('');

  useKeyboard((e) => {
    if (e.name === 'escape') {
      navigate({ screen: 'rules' });
    }
  });

  const handleTargetSubmit = () => {
    const target = inputValue.trim();
    if (!target) return;
    setInputValue('');
    setState({ step: 'intent', target });
  };

  const handleIntentSubmit = () => {
    const intent = inputValue.trim();
    if (!intent) return;
    if (state.step !== 'intent') return;
    const { target } = state;
    setInputValue('');
    setState({ step: 'generating', target, intent });

    void generateRuleAdapter({ target, intent })
      .then((result) => {
        setState({ step: 'preview', target, intent, result });
      })
      .catch((err) => {
        setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  };

  const handleAccept = (_index: number, option: SelectOption | null) => {
    if (!option || state.step !== 'preview') return;

    if (option.name === 'Accept') {
      const { rule } = state.result;
      const result = createRuleAdapter({
        title: rule.title,
        severity: rule.severity,
        globs: rule.globs,
        instructions: rule.instructions,
        id: rule.id,
        examples: rule.examples,
      });
      setState({ step: 'done', rule: result.rule });
    } else if (option.name === 'Edit intent') {
      setInputValue('');
      setState({ step: 'intent', target: state.target });
    } else {
      navigate({ screen: 'rules' });
    }
  };

  if (state.step === 'target') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Create Rule</text>
        <box paddingTop={1}>
          <text fg={theme.text}>Target (file path, directory, or glob pattern):</text>
        </box>
        <box paddingTop={1}>
          <input
            focused
            value={inputValue}
            placeholder="e.g. src/components/**/*.tsx"
            textColor={theme.text}
            placeholderColor={theme.textDim}
            cursorColor={theme.accent}
            onInput={setInputValue}
            onSubmit={handleTargetSubmit}
          />
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Enter to submit · ESC cancel</text>
        </box>
      </box>
    );
  }

  if (state.step === 'intent') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Create Rule</text>
        <text fg={theme.textDim}>Target: {state.target}</text>
        <box paddingTop={1}>
          <text fg={theme.text}>What should this rule enforce?</text>
        </box>
        <box paddingTop={1}>
          <input
            focused
            value={inputValue}
            placeholder="e.g. All React components must use named exports"
            textColor={theme.text}
            placeholderColor={theme.textDim}
            cursorColor={theme.accent}
            onInput={setInputValue}
            onSubmit={handleIntentSubmit}
          />
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Enter to submit · ESC cancel</text>
        </box>
      </box>
    );
  }

  if (state.step === 'generating') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Create Rule</text>
        <box paddingTop={1}>
          <Spinner label="Generating rule..." />
        </box>
      </box>
    );
  }

  if (state.step === 'preview') {
    const { rule, preview } = state.result;
    const confirmOptions: SelectOption[] = [
      { name: 'Accept', description: 'Save this rule' },
      { name: 'Edit intent', description: 'Try again with a different intent' },
      { name: 'Cancel', description: 'Discard and go back' },
    ];

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box paddingLeft={2} paddingTop={1}>
          <text fg={theme.accent}>Rule Preview</text>
        </box>
        <scrollbox flexGrow={1} paddingLeft={2} paddingTop={1}>
          <box flexDirection="column">
            <text fg={theme.text}>ID: {rule.id}</text>
            <text fg={theme.text}>Title: {rule.title}</text>
            <text fg={theme.text}>Severity: {rule.severity}</text>
            <text fg={theme.text}>Globs: {rule.globs.join(', ')}</text>
            <box paddingTop={1}>
              <text fg={theme.textDim}>{rule.instructions}</text>
            </box>
            {preview.flaggedCount > 0 && (
              <box flexDirection="column" paddingTop={1}>
                <text fg={theme.error}>Would flag ({preview.flaggedCount} files):</text>
                {preview.flaggedFiles.slice(0, 5).map((f) => (
                  <text key={f} fg={theme.textDim}>
                    {' '}
                    {f}
                  </text>
                ))}
                {preview.flaggedCount > 5 && <text fg={theme.textDim}> ... and {preview.flaggedCount - 5} more</text>}
              </box>
            )}
            {preview.passedCount > 0 && (
              <box flexDirection="column" paddingTop={1}>
                <text fg={theme.success}>Would pass ({preview.passedCount} files):</text>
                {preview.passedFiles.slice(0, 3).map((f) => (
                  <text key={f} fg={theme.textDim}>
                    {' '}
                    {f}
                  </text>
                ))}
                {preview.passedCount > 3 && <text fg={theme.textDim}> ... and {preview.passedCount - 3} more</text>}
              </box>
            )}
            {preview.flaggedCount === 0 && preview.passedCount === 0 && (
              <box paddingTop={1}>
                <text fg={theme.warning}>No files matched the target globs.</text>
              </box>
            )}
          </box>
        </scrollbox>

        <box paddingLeft={2} paddingBottom={1}>
          <select focused flexGrow={1} options={confirmOptions} {...selectColors} onSelect={handleAccept} />
        </box>
      </box>
    );
  }

  if (state.step === 'done') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.success}>Rule created: {state.rule.id}</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC back to rules</text>
        </box>
      </box>
    );
  }

  // error
  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <text fg={theme.error}>Error: {state.message}</text>
      <box paddingTop={1}>
        <text fg={theme.textDim}>ESC back to rules</text>
      </box>
    </box>
  );
}
