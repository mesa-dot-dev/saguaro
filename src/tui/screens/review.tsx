import type { ClassicReviewResult } from '../../adapter/classic-review.js';
import type { ReviewEngineOutcome } from '../../core/types.js';
import type { ReviewProgressEvent, ReviewResult } from '../../types/types.js';
import { getDefaultBranch } from '../../git/git.js';
import { runClassicReview } from '../../adapter/classic-review.js';
import { runReview } from '../../adapter/review.js';
import { useKeyboard } from '@opentui/react';
import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '../components/spinner.js';
import { useRouter } from '../lib/router.js';
import { theme } from '../lib/theme.js';

type ReviewState =
  | { phase: 'running'; completedBatches: number; totalBatches: number }
  | { phase: 'done'; outcome: ReviewEngineOutcome }
  | { phase: 'classic-done'; result: ClassicReviewResult }
  | { phase: 'full-done'; rulesResult: ReviewResult | null; classicResult: ClassicReviewResult }
  | { phase: 'error'; message: string };

interface ReviewScreenProps {
  baseRef?: string;
  headRef?: string;
  mode?: 'rules' | 'classic' | 'full';
}

export function ReviewScreen({ baseRef, headRef, mode = 'rules' }: ReviewScreenProps) {
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

    if (mode === 'classic') {
      void runClassicReview({ baseRef: effectiveBase, headRef: effectiveHead, abortSignal: abortController.signal })
        .then((result) => setState({ phase: 'classic-done', result }))
        .catch((err) => {
          if (!abortController.signal.aborted) {
            setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
          }
        });
    } else if (mode === 'full') {
      void Promise.all([
        runReview({
          baseRef: effectiveBase,
          headRef: effectiveHead,
          verbose: false,
          onProgress,
          abortSignal: abortController.signal,
          source: 'cli',
        }),
        runClassicReview({ baseRef: effectiveBase, headRef: effectiveHead, abortSignal: abortController.signal }),
      ])
        .then(([rulesResult, classicResult]) => {
          const outcome = rulesResult.outcome;
          const rulesReviewResult = outcome.kind === 'reviewed' ? outcome.result : null;
          setState({ phase: 'full-done', rulesResult: rulesReviewResult, classicResult });
        })
        .catch((err) => {
          if (!abortController.signal.aborted) {
            setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) });
          }
        });
    } else {
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
    }

    return () => abortController.abort();
  }, [navigate, effectiveBase, effectiveHead, mode]);

  if (state.phase === 'error') {
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.error}>Error: {state.message}</text>
        <text fg={theme.textDim}>Press ESC to go back</text>
      </box>
    );
  }

  if (state.phase === 'classic-done') {
    const { result } = state;
    if (result.findings.length === 0) {
      return (
        <box flexDirection="column" paddingLeft={2} paddingTop={1}>
          <text fg={theme.success}>Mesa review: No issues found</text>
          <text fg={theme.textDim}>Model: {result.model}</text>
          <text fg={theme.textDim}>Press ESC to go back</text>
        </box>
      );
    }
    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.error}>Mesa review: {result.findings.length} issue(s) found</text>
        <text fg={theme.textDim}>Model: {result.model}</text>
        <box flexDirection="column" paddingTop={1}>
          {result.findings.map((f, i) => (
            <text key={i} fg={theme.text}>
              {f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : 'ℹ'} {f.file}
              {f.line ? `:${f.line}` : ''} — {f.message}
            </text>
          ))}
        </box>
        <box paddingTop={1}>
          <text fg={theme.textDim}>Press ESC to go back</text>
        </box>
      </box>
    );
  }

  if (state.phase === 'full-done') {
    const { rulesResult, classicResult } = state;
    const rulesViolations = rulesResult?.violations ?? [];
    const hasRulesIssues = rulesViolations.length > 0;
    const hasClassicIssues = classicResult.findings.length > 0;

    if (!hasRulesIssues && !hasClassicIssues) {
      return (
        <box flexDirection="column" paddingLeft={2} paddingTop={1}>
          <text fg={theme.success}>Full review: No issues found</text>
          <text fg={theme.textDim}>Press ESC to go back</text>
        </box>
      );
    }

    return (
      <box flexDirection="column" paddingLeft={2} paddingTop={1}>
        <text fg={theme.accent}>Full Review Results</text>
        {hasRulesIssues && (
          <box flexDirection="column" paddingTop={1}>
            <text fg={theme.error}>Rules: {rulesViolations.length} violation(s)</text>
            {rulesViolations.map((v, i) => (
              <text key={`rule-${i}`} fg={theme.text}>
                {'  '}
                {v.severity === 'error' ? '✗' : '⚠'} {v.file}
                {v.line ? `:${v.line}` : ''} — {v.message}
              </text>
            ))}
          </box>
        )}
        {!hasRulesIssues && (
          <box paddingTop={1}>
            <text fg={theme.success}>Rules: No violations</text>
          </box>
        )}
        {hasClassicIssues && (
          <box flexDirection="column" paddingTop={1}>
            <text fg={theme.error}>Classic review: {classicResult.findings.length} issue(s)</text>
            {classicResult.findings.map((f, i) => (
              <text key={`classic-${i}`} fg={theme.text}>
                {'  '}
                {f.severity === 'error' ? '✗' : f.severity === 'warning' ? '⚠' : 'ℹ'} {f.file}
                {f.line ? `:${f.line}` : ''} — {f.message}
              </text>
            ))}
          </box>
        )}
        {!hasClassicIssues && (
          <box paddingTop={1}>
            <text fg={theme.success}>Classic review: No issues</text>
          </box>
        )}
        <box paddingTop={1}>
          <text fg={theme.textDim}>Press ESC to go back</text>
        </box>
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
      <text fg={theme.accent}>
        Running {mode === 'classic' ? 'Classic' : mode === 'full' ? 'Full' : 'Rules'} Review
      </text>
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
