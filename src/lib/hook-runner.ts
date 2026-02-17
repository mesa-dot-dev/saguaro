import path from 'node:path';
import { runReview } from '../adapter/review.js';
import { getCodebaseContext } from '../indexer/index.js';
import type { Violation } from '../types/types.js';
import {
  getLocalDiffs,
  getRepoRoot,
  getUntrackedDiffs,
  listLocalChangedFilesFromGit,
  listUntrackedFiles,
} from './git.js';
import { loadValidatedConfig } from './review-model-config.js';

export interface HookDecision {
  decision: 'allow' | 'block';
  reason?: string;
}

export interface HookRunOptions {
  config?: string;
  verbose?: boolean;
  abortSignal?: AbortSignal;
}

export async function runHookReview(options: HookRunOptions): Promise<HookDecision> {
  // Only review uncommitted local changes and untracked files. don't review committed changes. It would burn tokens and be redundant.
  const localChangedFiles = listLocalChangedFilesFromGit();
  const untrackedFiles = listUntrackedFiles();
  const allChangedFiles = [...new Set([...localChangedFiles, ...untrackedFiles])];

  if (allChangedFiles.length === 0) {
    return { decision: 'allow' };
  }

  const localDiffs = getLocalDiffs();
  const untrackedDiffs = getUntrackedDiffs();
  const mergedDiffs = new Map([...localDiffs, ...untrackedDiffs]);

  const config = loadValidatedConfig(options.config);
  const indexSettings = {
    enabled: config.index.enabled,
    blastRadiusDepth: config.index.blast_radius_depth,
    contextTokenBudget: config.index.context_token_budget,
  };

  let codebaseContext = '';
  if (indexSettings.enabled) {
    const repoRoot = getRepoRoot();
    codebaseContext = await getCodebaseContext({
      rootDir: repoRoot,
      cacheDir: path.join(repoRoot, '.mesa', 'cache'),
      changedFiles: allChangedFiles,
      blastRadiusDepth: indexSettings.blastRadiusDepth,
      tokenBudget: indexSettings.contextTokenBudget,
      verbose: options.verbose,
    });
  }

  const { outcome } = await runReview({
    baseRef: 'HEAD',
    headRef: 'HEAD',
    changedFilesOverride: allChangedFiles,
    verbose: options.verbose,
    configPath: options.config,
    codebaseContext,
    diffs: mergedDiffs,
    abortSignal: options.abortSignal,
  });

  if (outcome.kind !== 'reviewed') {
    return { decision: 'allow' };
  }

  const violations = outcome.result.violations;
  if (violations.length === 0) {
    return { decision: 'allow' };
  }

  return {
    decision: 'block',
    reason: formatViolationsForClaude(violations),
  };
}

export function formatViolationsForClaude(violations: Violation[]): string {
  const lines: string[] = [];
  lines.push(`Code review found ${violations.length} violation(s). Fix these before completing the task:\n`);

  for (let i = 0; i < violations.length; i++) {
    const v = violations[i];
    const loc = v.line ? `${v.file}:${v.line}` : v.file;
    lines.push(`${i + 1}. **[${v.ruleId}]** ${v.severity} in \`${loc}\``);
    lines.push(`   ${v.message}`);
    if (v.suggestion) {
      lines.push(`   Suggestion: ${v.suggestion}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
