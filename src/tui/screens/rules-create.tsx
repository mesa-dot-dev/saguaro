import type { GenerateRuleAdapterResult } from '../../adapter/rules.js';
import type { RulePolicy } from '../../types/types.js';
import { createRuleAdapter, generateRuleAdapter } from '../../adapter/rules.js';
import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useMemo, useState } from 'react';
import { Spinner } from '../components/spinner.js';
import { useScreenInput } from '../lib/input-bar-context.js';
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

  useKeyboard((e) => {
    if (e.name === 'escape') {
      navigate({ screen: 'rules' });
    }
  });

  const handleTargetSubmit = useMemo(
    () => (value: string) => {
      const target = value.trim();
      if (!target) return;
      setState({ step: 'intent', target });
    },
    []
  );

  const handleIntentSubmit = useMemo(
    () => (value: string) => {
      const intent = value.trim();
      if (!intent) return;
      if (state.step !== 'intent') return;
      const { target } = state;
      setState({ step: 'generating', target, intent });

      void generateRuleAdapter({ target, intent })
        .then((result) => {
          setState({ step: 'preview', target, intent, result });
        })
        .catch((err) => {
          setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
        });
    },
    [state]
  );

  const screenInputConfig = useMemo(() => {
    if (state.step === 'target') {
      return { placeholder: 'e.g. src/components/**/*.tsx', onSubmit: handleTargetSubmit };
    }
    if (state.step === 'intent') {
      return { placeholder: 'e.g. All React components must use named exports', onSubmit: handleIntentSubmit };
    }
    return null;
  }, [state.step, handleTargetSubmit, handleIntentSubmit]);

  useScreenInput(screenInputConfig);

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

    const previewSummary = [
      `ID: ${rule.id}`,
      `Title: ${rule.title}`,
      `Severity: ${rule.severity}`,
      `Globs: ${rule.globs.join(', ')}`,
    ];
    if (preview.flaggedCount > 0) {
      previewSummary.push(`Would flag: ${preview.flaggedCount} file(s)`);
    }
    if (preview.passedCount > 0) {
      previewSummary.push(`Would pass: ${preview.passedCount} file(s)`);
    }
    if (preview.flaggedCount === 0 && preview.passedCount === 0) {
      previewSummary.push('No files matched the target globs.');
    }

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box paddingLeft={2} paddingTop={1} flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
          <text fg={theme.accent}>Rule Preview</text>
          <box paddingTop={1} flexDirection="column">
            {previewSummary.map((line) => (
              <text key={line} fg={theme.text}>
                {line}
              </text>
            ))}
          </box>
          <box paddingTop={1}>
            <text fg={theme.textDim}>{rule.instructions}</text>
          </box>
        </box>

        <box flexDirection="column" paddingLeft={2} flexShrink={0} minHeight={7}>
          <select focused flexGrow={1} options={confirmOptions} {...selectColors} onSelect={handleAccept} />
        </box>

        <box paddingLeft={2} paddingBottom={1} flexShrink={0}>
          <text fg={theme.textDim}>↑↓ navigate · enter select · ESC cancel</text>
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
