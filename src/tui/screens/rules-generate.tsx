import type { RulePolicy } from '@mesa/code-review';
import { commitGeneratedRules, generateRulesFromCodebase } from '@mesa/code-review';
import type { SelectOption } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { Spinner } from '../components/spinner.js';
import { useRouter } from '../lib/router.js';
import { selectColors, theme } from '../lib/theme.js';

type GenerateStep =
  | { step: 'running'; status: string }
  | { step: 'review'; rules: RulePolicy[]; accepted: Set<string> }
  | { step: 'done'; written: number }
  | { step: 'error'; message: string };

export function RulesGenerateScreen() {
  const { navigate } = useRouter();
  const [state, setState] = useState<GenerateStep>({ step: 'running', status: 'Scanning codebase...' });

  useKeyboard((e) => {
    if (e.name === 'escape') {
      navigate({ screen: 'rules' });
      return;
    }
    if (e.name === 's' && state.step === 'review') {
      const result = commitGeneratedRules(Array.from(state.accepted), state.rules);
      setState({ step: 'done', written: result.written.length });
    }
  });

  useEffect(() => {
    const abortController = new AbortController();

    const onProgress = (event: { type: string; totalFiles?: number; candidateCount?: number }) => {
      switch (event.type) {
        case 'indexing':
          setState({ step: 'running', status: 'Indexing codebase...' });
          break;
        case 'scan_complete':
          setState({ step: 'running', status: `Found ${event.totalFiles} source files` });
          break;
        case 'zone_started':
          setState((prev) =>
            prev.step === 'running' ? { step: 'running', status: 'Analyzing files for patterns...' } : prev
          );
          break;
        case 'synthesis_started':
          setState({ step: 'running', status: `Refining ${event.candidateCount} candidate rules...` });
          break;
        case 'generator_complete':
          setState((prev) => (prev.step === 'running' ? { step: 'running', status: 'Finalizing...' } : prev));
          break;
      }
    };

    void generateRulesFromCodebase({
      onProgress,
      abortSignal: abortController.signal,
    })
      .then((result) => {
        if (result.rules.length === 0) {
          setState({ step: 'done', written: 0 });
        } else {
          setState({
            step: 'review',
            rules: result.rules,
            accepted: new Set(result.rules.map((r) => r.id)),
          });
        }
      })
      .catch((err) => {
        if (!abortController.signal.aborted) {
          setState({ step: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });

    return () => abortController.abort();
  }, []);

  if (state.step === 'running') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Generate Rules</text>
        <box paddingTop={1}>
          <Spinner label={state.status} />
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>ESC cancel</text>
        </box>
      </box>
    );
  }

  if (state.step === 'review') {
    const { rules, accepted } = state;

    const options: SelectOption[] = rules.map((r) => ({
      name: `${accepted.has(r.id) ? '[x]' : '[ ]'} [${r.severity}] ${r.id} — ${r.title}`,
      description: r.id,
    }));

    const handleToggle = (_index: number, option: SelectOption | null) => {
      if (!option) return;
      setState((prev) => {
        if (prev.step !== 'review') return prev;
        const next = new Set(prev.accepted);
        if (next.has(option.description)) {
          next.delete(option.description);
        } else {
          next.add(option.description);
        }
        return { ...prev, accepted: next };
      });
    };

    return (
      <box flexDirection="column" width="100%" height="100%">
        <box paddingLeft={2} paddingTop={1}>
          <text fg={theme.accent}>
            Generated {rules.length} rule(s) — {accepted.size} accepted
          </text>
        </box>

        <box flexDirection="column" paddingLeft={2} flexGrow={1} flexShrink={0} minHeight={5}>
          <select focused flexGrow={1} options={options} {...selectColors} onSelect={handleToggle} />
        </box>

        <box paddingLeft={2} paddingBottom={1} flexDirection="column" flexShrink={0}>
          <box>
            <text fg={theme.textDim}>enter toggle · s save accepted · ESC cancel</text>
          </box>
        </box>
      </box>
    );
  }

  if (state.step === 'done') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={state.written > 0 ? theme.success : theme.warning}>
          {state.written > 0 ? `${state.written} rule(s) saved to .mesa/rules/` : 'No rules generated.'}
        </text>
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
