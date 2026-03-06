import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import type { ValidateRulesAdapterResult } from '../../adapter/rules.js';
import { validateRulesAdapter } from '../../adapter/rules.js';
import { useRouter } from '../lib/router.js';
import { theme } from '../lib/theme.js';

export function RulesValidateScreen() {
  const { navigate } = useRouter();
  const [result, setResult] = useState<ValidateRulesAdapterResult | null>(null);

  useKeyboard((e) => {
    if (e.name === 'escape') {
      navigate({ screen: 'rules' });
    }
  });

  useEffect(() => {
    setResult(validateRulesAdapter());
  }, []);

  if (!result) {
    return (
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.textDim}>Validating...</text>
      </box>
    );
  }

  const hasErrors = result.errors.length > 0;

  return (
    <box flexDirection="column" width="100%" height="100%">
      <box paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Rule Validation</text>
      </box>

      <scrollbox focused flexGrow={1} paddingLeft={2} paddingTop={1}>
        <box flexDirection="column">
          {result.validated.length > 0 && (
            <box flexDirection="column" paddingBottom={1}>
              <text fg={theme.success}>{result.validated.length} rule(s) valid</text>
              {result.validated.map((id) => (
                <text key={id} fg={theme.textDim}>
                  {'  '}✓ {id}
                </text>
              ))}
            </box>
          )}

          {hasErrors && (
            <box flexDirection="column" paddingBottom={1}>
              <text fg={theme.error}>{result.errors.length} rule(s) with errors</text>
              {result.errors.map((e) => (
                <box key={e.file} flexDirection="column">
                  <text fg={theme.error}>
                    {'  '}✗ {e.file}
                  </text>
                  {e.errors.map((msg, i) => (
                    <text key={`${e.file}-${i}`} fg={theme.textDim}>
                      {'    '}
                      {msg}
                    </text>
                  ))}
                </box>
              ))}
            </box>
          )}

          {result.validated.length === 0 && !hasErrors && <text fg={theme.textDim}>No rules found.</text>}
        </box>
      </scrollbox>

      <box paddingLeft={2} paddingBottom={1}>
        <text fg={theme.textDim}>↑↓ scroll · ESC back</text>
      </box>
    </box>
  );
}
