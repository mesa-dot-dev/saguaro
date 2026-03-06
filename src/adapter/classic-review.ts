import {
  createClaudeCliRunner,
  createCodexCliRunner,
  createGeminiCliRunner,
  isCliAuthenticated,
} from '../ai/agent-runner.js';
import { loadValidatedConfig, type ModelProvider, resolveModelForReview } from '../config/model-config.js';
import type { AgentRunner } from '../core/types.js';
import { buildStaffEngineerPrompt, parseFindings, stripDiffContext } from '../daemon/prompt.js';
import type { Finding } from '../daemon/store.js';
import { getDiffs, getRepoRoot, listChangedFilesFromGit } from '../git/git.js';
import { logger } from '../util/logger.js';

export interface ClassicReviewRequest {
  baseRef: string;
  headRef: string;
  configPath?: string;
  abortSignal?: AbortSignal;
}

export interface ClassicReviewResult {
  findings: Finding[];
  verdict: 'pass' | 'fail';
  model: string;
}

export async function runClassicReview(request: ClassicReviewRequest): Promise<ClassicReviewResult> {
  const config = loadValidatedConfig(request.configPath);
  const modelName = resolveModelForReview(config, 'classic');
  const model = modelName === 'default' ? undefined : modelName;

  const changedFiles = listChangedFilesFromGit(request.baseRef, request.headRef);
  if (changedFiles.length === 0) {
    return { findings: [], verdict: 'pass', model: modelName };
  }

  const diffs = getDiffs(request.baseRef, request.headRef);
  const compactDiffs = new Map<string, string>();
  for (const [file, diff] of diffs) {
    compactDiffs.set(file, stripDiffContext(diff));
  }

  const prompt = buildStaffEngineerPrompt({
    diffs: compactDiffs,
    agentSummary: null,
    customCriteria: config.review.classic_prompt,
  });

  const MAX_PROMPT_CHARS = 250 * 1024;
  if (prompt.length > MAX_PROMPT_CHARS) {
    logger.info(
      `[classic-review] Prompt too large (${(prompt.length / 1024).toFixed(0)}KB > ${MAX_PROMPT_CHARS / 1024}KB), skipping review`
    );
    return { findings: [], verdict: 'pass', model: modelName };
  }

  logger.debug(`[classic-review] Running Mesa classic review with ${changedFiles.length} files`);

  const runner = resolveClassicRunner(config.model.provider);
  const result = await runner.execute({
    systemPrompt: '',
    prompt,
    cwd: getRepoRoot(),
    maxTurns: config.review.max_steps,
    model,
    allowedTools: ['Read', 'Glob', 'Grep'],
    abortSignal: request.abortSignal,
  });

  const findings = parseFindings(result.output);
  const verdict = findings.length > 0 ? 'fail' : 'pass';

  return {
    findings,
    verdict,
    model: modelName,
  };
}

function resolveClassicRunner(provider: ModelProvider): AgentRunner {
  switch (provider) {
    case 'openai': {
      if (!isCliAuthenticated('codex')) {
        throw new Error(
          'OpenAI models require the Codex CLI for classic reviews. Install it from https://github.com/openai/codex'
        );
      }
      return createCodexCliRunner();
    }
    case 'google': {
      if (!isCliAuthenticated('gemini')) {
        throw new Error(
          'Google models require the Gemini CLI for classic reviews. Install it from https://github.com/google-gemini/gemini-cli'
        );
      }
      return createGeminiCliRunner();
    }
    case 'anthropic':
      return createClaudeCliRunner();
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unsupported provider for classic reviews: ${_exhaustive}`);
    }
  }
}
