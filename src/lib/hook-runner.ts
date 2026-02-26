import path from 'node:path';
import { runReview } from '../adapter/review.js';
import { getCodebaseContext } from '../indexer/index.js';
import type { RulePolicy, Violation } from '../types/types.js';
import { matchesGlobs } from './constants.js';
import {
  getLocalDiffs,
  getRepoRoot,
  getUntrackedDiffs,
  listLocalChangedFilesFromGit,
  listUntrackedFiles,
} from './git.js';
import { loadMesaRules } from './mesa-rules.js';
import { loadValidatedConfig } from './review-model-config.js';
import { sortRulesByPriority } from './rule-resolution.js';

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
    source: 'hook',
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

/** Load all Mesa rules for a given file. Returns null when no rules match. */
export function resolveRulesForFileAsMarkdown(absoluteFilePath: string, repoRoot: string): string | null {
  return resolveRulesForFile(absoluteFilePath, repoRoot).markdown;
}

function resolveRulesForFile(
  absoluteFilePath: string,
  repoRoot: string
): { markdown: string | null; matchedCount: number } {
  const { rules } = loadMesaRules(repoRoot);
  if (rules.length === 0) return { markdown: null, matchedCount: 0 };

  const relativePath = path.relative(repoRoot, absoluteFilePath);

  const matched: RulePolicy[] = [];
  for (const rule of rules) {
    if (matchesGlobs(relativePath, rule.policy.globs)) {
      matched.push(rule.policy);
    }
  }

  if (matched.length === 0) return { markdown: null, matchedCount: 0 };

  const sorted = sortRulesByPriority(matched);
  return { markdown: formatRulesAsContext(sorted), matchedCount: sorted.length };
}

export interface PreToolHookInput {
  session_id?: string;
  hook_event_name: string;
  tool_name: string;
  tool_input: {
    file_path?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface PreToolHookResult {
  exitCode: number;
  stdout: string | null;
  matchedCount: number;
}

export function runPreToolHook(options: { input: PreToolHookInput; repoRoot: string }): PreToolHookResult {
  const { input, repoRoot } = options;
  const filePath = input.tool_input?.file_path;
  if (!filePath) return { exitCode: 0, stdout: null, matchedCount: 0 };

  const { markdown, matchedCount } = resolveRulesForFile(filePath, repoRoot);
  if (!markdown) return { exitCode: 0, stdout: null, matchedCount: 0 };

  const response = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: markdown,
    },
  };

  return { exitCode: 0, stdout: JSON.stringify(response), matchedCount };
}

function formatRulesAsContext(rules: RulePolicy[]): string {
  const parts: string[] = [];
  parts.push(`# Mesa: ${rules.length} rule(s) apply to this file\n`);
  parts.push('Follow ALL of these rules when making your changes:\n');

  for (const rule of rules) {
    parts.push(`## ${rule.id} (${rule.severity})\n`);
    parts.push(rule.instructions);

    if (rule.examples?.violations?.length) {
      parts.push('\n### Violations\n');
      for (const v of rule.examples.violations) {
        parts.push('```');
        parts.push(v);
        parts.push('```\n');
      }
    }

    if (rule.examples?.compliant?.length) {
      parts.push('### Compliant\n');
      for (const c of rule.examples.compliant) {
        parts.push('```');
        parts.push(c);
        parts.push('```\n');
      }
    }

    parts.push('---\n');
  }

  return parts.join('\n').trimEnd();
}
