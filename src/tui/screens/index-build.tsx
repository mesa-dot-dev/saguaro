import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { runBuildIndex } from '../../adapter/index-build.js';
import { Spinner } from '../components/spinner.js';
import { useRouter } from '../lib/router.js';
import { theme } from '../lib/theme.js';

type IndexState =
  | { phase: 'building' }
  | { phase: 'done'; fileCount: number; durationMs: number; savedTo: string }
  | { phase: 'error'; message: string };

export function IndexBuildScreen() {
  const { goHome } = useRouter();
  const [state, setState] = useState<IndexState>({ phase: 'building' });

  useKeyboard((e) => {
    if (e.name === 'escape') goHome();
  });

  useEffect(() => {
    void runBuildIndex()
      .then((result) => {
        setState({
          phase: 'done',
          fileCount: result.fileCount,
          durationMs: result.durationMs,
          savedTo: result.savedTo,
        });
      })
      .catch((err) => {
        setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
      });
  }, []);

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
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.success}>
          Index built: {state.fileCount} files in {state.durationMs}ms
        </text>
        <text fg={theme.textDim}>Saved to {state.savedTo}</text>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Press ESC to go back</text>
        </box>
      </box>
    );
  }

  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <text fg={theme.accent}>Index</text>
      <box paddingTop={1}>
        <Spinner label="Building codebase index..." />
      </box>
      <box paddingTop={1}>
        <text fg={theme.textDim}>Press ESC to go back</text>
      </box>
    </box>
  );
}
