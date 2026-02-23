import fs from 'node:fs';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import { z } from 'zod';
import { ApiKeyMissingError, ConfigInvalidError, ConfigMissingError } from './errors.js';
import { logger } from './logger.js';
import { findRepoRoot } from './rule-resolution.js';

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
});

const ReviewSchema = z.object({
  max_steps: z.number().int().positive().default(10),
  files_per_batch: z.number().int().positive().default(3),
});

const HookSchema = z.object({
  enabled: z.boolean().default(true),
});

export const MesaConfigSchema = z
  .object({
    model: z.object({
      provider: ModelProviderSchema,
      name: z.string().min(1, 'model.name must not be empty'),
    }),
    api_keys: z.record(z.string(), z.string()).optional(),
    output: OutputSchema.default({ cursor_deeplink: true }),
    index: IndexSchema.default({ enabled: true, blast_radius_depth: 1, context_token_budget: 4000 }),
    review: ReviewSchema.default({ max_steps: 10, files_per_batch: 3 }),
    hook: HookSchema.default({ enabled: true }),
  })
  .strict();

export type MesaConfig = z.infer<typeof MesaConfigSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

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
  maxSteps?: number;
  filesPerWorker?: number;
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
    `[config] index: enabled=${result.data.index.enabled}, blastRadius=${result.data.index.blast_radius_depth}, tokenBudget=${result.data.index.context_token_budget}`
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

function createLanguageModel(config: ResolvedModelConfig): LanguageModel {
  switch (config.provider) {
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(config.model);
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(config.model);
    case 'google':
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model);
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
