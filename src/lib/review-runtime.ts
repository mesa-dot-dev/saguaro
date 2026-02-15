import type { Reviewer } from '../core/review.js';
import type { RulePolicy } from '../types/types.js';
import { AgentExecutionError } from './errors.js';
import { getFileAtRef, listChangedFilesFromGit } from './git.js';
import {
  loadReviewAdapterConfig,
  type ResolvedModelConfig,
  resolveModelFromResolvedConfig,
} from './review-model-config.js';
import { runReviewAgent } from './review-runner.js';
import { resolveSkillsForFiles } from './skills.js';

export interface ReviewRuntime {
  listChangedFiles(baseRef: string, headRef: string): Promise<string[]> | string[];
  loadRules(
    changedFiles: string[],
    skillsDir?: string
  ):
    | Promise<{
        filesWithRules: Map<string, RulePolicy[]>;
        rulesLoaded: number;
      }>
    | {
        filesWithRules: Map<string, RulePolicy[]>;
        rulesLoaded: number;
      };
  createReviewer(configPath?: string): Reviewer;
}

function createGitFileResolver(ref: string): (filePath: string) => string | null {
  const cache = new Map<string, string | null>();
  return (filePath: string) => {
    if (cache.has(filePath)) return cache.get(filePath)!;
    const content = getFileAtRef(ref, filePath);
    cache.set(filePath, content);
    return content;
  };
}

export function createNodeReviewRuntime(): ReviewRuntime {
  return {
    listChangedFiles(baseRef, headRef) {
      return listChangedFilesFromGit(baseRef, headRef);
    },
    loadRules(changedFiles, skillsDir) {
      return resolveSkillsForFiles(changedFiles, { explicitSkillsDir: skillsDir });
    },
    createReviewer(configPath) {
      const resolvedConfig = loadReviewAdapterConfig(configPath);
      const modelConfig: ResolvedModelConfig = resolvedConfig.modelConfig;
      const model = resolveModelFromResolvedConfig(modelConfig);

      return {
        async review(input) {
          try {
            return await runReviewAgent({
              filesWithRules: input.filesWithRules,
              diffs: input.diffs ?? new Map(),
              model,
              filesPerWorker: resolvedConfig.filesPerWorker,
              maxSteps: resolvedConfig.maxSteps,
              verbose: input.verbose,
              codebaseContext: input.codebaseContext,
              onProgress: input.onProgress,
              resolveFile: createGitFileResolver(input.headRef),
              abortSignal: input.abortSignal,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new AgentExecutionError(message, error);
          }
        },
      };
    },
  };
}
