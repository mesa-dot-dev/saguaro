import fs from 'node:fs';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import { z } from 'zod';
import type { AgentName } from '../daemon/agent-cli.js';
import { findRepoRoot } from '../git/git.js';
import { ApiKeyMissingError, ConfigInvalidError, ConfigMissingError } from '../util/errors.js';
import { logger } from '../util/logger.js';

// ---------------------------------------------------------------------------
// Zod config schema
// ---------------------------------------------------------------------------

const ModelProviderSchema = z.enum(['anthropic', 'openai', 'google']);

const OutputSchema = z.object({
  cursor_deeplink: z.boolean().default(true),
});

const IndexSchema = z.object({
  enabled: z.boolean().default(true),
  blast_radius_depth: z.number().int().positive().default(1),
  context_token_budget: z.number().int().positive().default(4000),
  max_blast_radius_files: z.number().int().positive().default(100),
});

const ReviewKindSchema = z.object({
  model: z.string().optional(),
});

const ReviewSchema = z.object({
  max_steps: z.number().int().positive().default(10),
  files_per_batch: z.number().int().positive().default(2),
  classic_prompt: z.string().optional(),
  rules: ReviewKindSchema.optional(),
  classic: ReviewKindSchema.optional(),
});

const HookSchema = z.object({
  enabled: z.boolean().default(true),
  stop: z
    .object({
      enabled: z.boolean().default(false),
    })
    .default({ enabled: false }),
});

const DaemonSchema = z.object({
  enabled: z.boolean().default(false),
  workers: z.number().int().positive().max(2).default(1),
  idle_timeout: z.number().int().positive().default(1800),
  model: z.string().optional(),
});

export const MesaConfigSchema = z
  .object({
    model: z.object({
      provider: ModelProviderSchema,
      name: z.string().min(1, 'model.name must not be empty'),
    }),
    output: OutputSchema.default(() => OutputSchema.parse({})),
    index: IndexSchema.default(() => IndexSchema.parse({})),
    review: ReviewSchema.default(() => ReviewSchema.parse({})),
    hook: HookSchema.default(() => HookSchema.parse({})),
    daemon: DaemonSchema.optional(),
  })
  .strict();

export type MesaConfig = z.infer<typeof MesaConfigSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export type ReviewKind = 'rules' | 'classic' | 'daemon';

export function resolveModelForReview(config: MesaConfig, kind: ReviewKind): string {
  switch (kind) {
    case 'rules':
      return config.review.rules?.model ?? config.model.name;
    case 'classic':
      return config.review.classic?.model ?? config.model.name;
    case 'daemon':
      return config.daemon?.model ?? config.model.name;
  }
}

const PROVIDER_CLI_MAP: Record<ModelProvider, AgentName> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
};

export function getCliForProvider(provider: ModelProvider): AgentName {
  return PROVIDER_CLI_MAP[provider];
}

/** Known CLI aliases that resolve to the latest version of a model family. */
const CLI_ALIASES = new Set(['sonnet', 'opus', 'haiku', 'default']);

/**
 * Format a model name for display. If it's a CLI alias, appends a hint
 * that it resolves to the latest version.
 */
export function formatModelForDisplay(modelName: string): string {
  if (CLI_ALIASES.has(modelName)) {
    return `${modelName} (latest)`;
  }
  return modelName;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export interface ResolvedModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
}

export interface LoadedReviewAdapterConfig {
  modelConfig: ResolvedModelConfig;
  maxSteps: number;
  filesPerWorker: number;
  classicPrompt?: string;
}

export function loadValidatedConfig(configPath?: string): MesaConfig {
  const resolvedPath = resolveMesaConfigPath(configPath);
  if (!resolvedPath) {
    throw new ConfigMissingError();
  }

  const contents = fs.readFileSync(resolvedPath, 'utf8');
  const raw = yaml.load(contents);
  if (!raw || typeof raw !== 'object') {
    throw new ConfigInvalidError(`File at ${resolvedPath} is not a valid YAML object.`);
  }

  const result = MesaConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigInvalidError(`\n${issues}`);
  }

  logger.debug(`[config] Loaded config from ${resolvedPath}`);
  logger.debug(`[config] model: ${result.data.model.provider}/${result.data.model.name}`);
  logger.debug(
    `[config] review: maxSteps=${result.data.review.max_steps}, filesPerBatch=${result.data.review.files_per_batch}`
  );
  logger.debug(
    `[config] index: enabled=${result.data.index.enabled}, blastRadius=${result.data.index.blast_radius_depth}, maxFiles=${result.data.index.max_blast_radius_files}, tokenBudget=${result.data.index.context_token_budget}`
  );

  return result.data;
}

export function resolveApiKey(config: MesaConfig): string {
  loadLocalEnvFiles();

  const provider = config.model.provider;

  const envKeys: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };

  const envKey = envKeys[provider];
  if (envKey) {
    logger.debug(`[config] API key resolved for ${provider} (${envKey.slice(0, 4)}...${envKey.slice(-4)})`);
    return envKey;
  }

  throw new ApiKeyMissingError(provider);
}

function loadLocalEnvFiles(): void {
  const repoRoot = findRepoRoot();
  dotenv.config({ path: path.resolve(repoRoot, '.env.local'), quiet: true });
  dotenv.config({ path: path.resolve(repoRoot, '.env'), quiet: true });
}

export function resolveModelFromResolvedConfig(config: ResolvedModelConfig): LanguageModel {
  return createLanguageModel(config);
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4.1',
  google: 'gemini-2.5-pro',
};

function createLanguageModel(config: ResolvedModelConfig): LanguageModel {
  const modelId = config.model === 'default' ? (DEFAULT_MODELS[config.provider] ?? config.model) : config.model;
  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(modelId);
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(modelId);
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
}

export function loadReviewAdapterConfig(configPath?: string): LoadedReviewAdapterConfig {
  const config = loadValidatedConfig(configPath);

  return {
    modelConfig: {
      provider: config.model.provider,
      model: config.model.name,
      apiKey: resolveApiKey(config),
    },
    maxSteps: config.review.max_steps,
    filesPerWorker: config.review.files_per_batch,
    classicPrompt: config.review.classic_prompt,
  };
}

function resolveMesaConfigPath(configPath?: string): string | null {
  if (configPath) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    throw new ConfigInvalidError(`Config file not found: ${configPath}`);
  }

  const envPath = process.env.MESA_CONFIG;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const repoRoot = findRepoRoot();
  const defaultPath = path.resolve(repoRoot, '.mesa', 'config.yaml');
  if (fs.existsSync(defaultPath)) return defaultPath;

  return null;
}
