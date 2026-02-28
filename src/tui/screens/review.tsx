import type { ReviewEngineOutcome, ReviewProgressEvent } from '@mesa/code-review';
import { getDefaultBranch, runReview } from '@mesa/code-review';
import { useKeyboard } from '@opentui/react';
import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../components/spinner.js';
import { useRouter } from '../lib/router.js';
import { theme } from '../lib/theme.js';

type ReviewState =
  | { phase: 'running'; completedBatches: number; totalBatches: number }
  | { phase: 'done'; outcome: ReviewEngineOutcome }
  | { phase: 'error'; message: string };

interface ReviewScreenProps {
  baseRef?: string;
  headRef?: string;
}

export function ReviewScreen({ baseRef, headRef }: ReviewScreenProps) {
  const { navigate, goHome } = useRouter();
  const effectiveBase = useMemo(() => baseRef ?? getDefaultBranch(), [baseRef]);
  const effectiveHead = headRef ?? 'HEAD';
  const [state, setState] = useState<ReviewState>({
    phase: 'running',
    completedBatches: 0,
    totalBatches: 0,
  });

  useKeyboard((e) => {
    if (e.name === 'escape') {
      goHome();
    }
  });

  useEffect(() => {
    const abortController = new AbortController();

    const onProgress = (event: ReviewProgressEvent) => {
      if (event.type === 'run_split') {
        setState({ phase: 'running', completedBatches: 0, totalBatches: event.totalWorkers });
      } else if (event.type === 'worker_completed') {
        setState((prev) => {
          if (prev.phase !== 'running') return prev;
          return {
            phase: 'running',
            completedBatches: prev.completedBatches + 1,
            totalBatches: Math.max(prev.totalBatches, event.totalWorkers),
          };
        });
      }
    };

    void runReview({
      baseRef: effectiveBase,
      headRef: effectiveHead,
      verbose: false,
      onProgress,
      abortSignal: abortController.signal,
      source: 'cli',
    })
      .then((result) => {
        const outcome = result.outcome;
        if (outcome.kind === 'no-changed-files' || outcome.kind === 'no-matching-skills') {
          setState({ phase: 'done', outcome });
          return;
        }
        navigate({ screen: 'review-results', result: outcome.result });
      })
      .catch((err) => {
        if (!abortController.signal.aborted) {
          setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      });

    return () => abortController.abort();
  }, [navigate, effectiveBase, effectiveHead]);

  if (state.phase === 'error') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.error}>Error: {state.message}</text>
        <text fg={theme.textDim}>Press ESC to go back</text>
      </box>
    );
  }

  if (state.phase === 'done') {
    const msg =
      state.outcome.kind === 'no-changed-files'
        ? 'No changed files found.'
        : 'No rules matched the changed files. Review passed.';
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.success}>{msg}</text>
        <text fg={theme.textDim}>Press ESC to go back</text>
      </box>
    );
  }

  const progress = state.totalBatches > 0 ? `${state.completedBatches}/${state.totalBatches} batches` : 'preparing...';

  return (
    <box flexDirection="column" paddingLeft={2} paddingTop={1}>
      <text fg={theme.accent}>Running Review</text>
      <text fg={theme.textDim}>
        {effectiveBase} → {effectiveHead}
      </text>
      <box paddingTop={1}>
        <Spinner label={`Reviewing files... ${progress}`} />
      </box>
      <box paddingTop={1}>
        <text fg={theme.textDim}>Press ESC to cancel</text>
      </box>
    </box>
  );
}
