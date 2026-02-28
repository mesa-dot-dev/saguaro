import type { GeneratorProgressEvent, GeneratorResult } from '../generator/index.js';
import { generateRules } from '../generator/index.js';
import type { RulePolicy } from '../types/types.js';
import type { WriteGeneratedRulesResult } from './rules.js';
import { writeGeneratedRules } from './rules.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerateRulesOptions {
  configPath?: string;
  abortSignal?: AbortSignal;
  onProgress?: (event: GeneratorProgressEvent) => void;
}

export interface GenerateRulesResult {
  rules: RulePolicy[];
  summary: GeneratorResult['summary'];
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export async function generateRulesFromCodebase(options: GenerateRulesOptions): Promise<GenerateRulesResult> {
  const result = await generateRules({
    configPath: options.configPath,
    onProgress: options.onProgress,
    abortSignal: options.abortSignal,
  });

  return {
    rules: result.rules,
    summary: result.summary,
  };
}

export function commitGeneratedRules(acceptedRuleIds: string[], rules: RulePolicy[]): WriteGeneratedRulesResult {
  const accepted = rules.filter((r) => acceptedRuleIds.includes(r.id));
  return writeGeneratedRules(accepted);
}
