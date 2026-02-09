import fs from 'node:fs';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import yaml from 'js-yaml';

export type ModelProvider = 'anthropic' | 'openai' | 'google';

export interface ResolvedModelConfig {
  provider: ModelProvider;
  model: string;
  apiKey: string;
}

export interface MesaConfig {
  model?: {
    provider?: string;
    name?: string;
  };
  api_keys?: {
    anthropic?: string;
    openai?: string;
    google?: string;
  };
}

export interface LoadedReviewAdapterConfig {
  modelConfig: ResolvedModelConfig;
  maxSteps?: number;
  filesPerWorker?: number;
}

interface MesaAdapterConfig extends MesaConfig {
  review?: {
    max_steps_size?: number;
    files_per_worker?: number;
  };
}

const VALID_PROVIDERS: ModelProvider[] = ['anthropic', 'openai', 'google'];

export function loadMesaConfig(configPath?: string): MesaConfig {
  const resolvedPath = resolveMesaConfigPath(configPath);
  if (!resolvedPath) {
    throw new Error('Mesa config not found. Run "mesa init" or pass --config.');
  }

  const contents = fs.readFileSync(resolvedPath, 'utf8');
  const parsed = yaml.load(contents);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid Mesa config at ${resolvedPath}`);
  }
  return parsed as MesaConfig;
}

export function validateConfig(config: MesaConfig): void {
  const provider = config.model?.provider;
  const name = config.model?.name;

  if (!provider || !name) {
    throw new Error(
      'Invalid config: model.provider and model.name are required.\n' +
        '  Edit .mesa/config.yaml to set your model configuration.'
    );
  }

  if (!VALID_PROVIDERS.includes(provider as ModelProvider)) {
    throw new Error(
      `Invalid config: model.provider "${provider}" is not valid.\n` +
        `  Valid providers: ${VALID_PROVIDERS.join(', ')}\n` +
        '  Edit .mesa/config.yaml to fix this.'
    );
  }

  if (name === 'MODEL_NAME' || provider === 'PROVIDER') {
    throw new Error(
      'Invalid config: placeholder values detected.\n' +
        '  Edit .mesa/config.yaml and replace MODEL_NAME/PROVIDER with real values.\n' +
        '  Example: provider: anthropic, name: claude-sonnet-4-5'
    );
  }
}

export function resolveApiKey(config: MesaConfig): string {
  const provider = config.model?.provider ?? 'anthropic';

  const envKeys: Record<string, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };

  const envKey = envKeys[provider];
  if (envKey) return envKey;

  const configKeys = config.api_keys ?? {};
  const configKey = configKeys[provider as keyof typeof configKeys];
  if (configKey) return configKey;

  throw new Error(
    `No API key found for provider "${provider}". Set one via:\n` +
      `  1. export ${provider.toUpperCase()}_API_KEY=<key>\n` +
      '  2. Set api_keys in .mesa/config.yaml'
  );
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
  const parsed = loadMesaConfig(configPath) as MesaAdapterConfig;
  validateConfig(parsed);

  const provider = parsed.model?.provider as ModelProvider;
  const model = parsed.model?.name as string;

  const maxSteps = parsed.review?.max_steps_size;
  const filesPerWorker = parsed.review?.files_per_worker;

  return {
    modelConfig: {
      provider,
      model,
      apiKey: resolveApiKey(parsed),
    },
    maxSteps: typeof maxSteps === 'number' ? maxSteps : undefined,
    filesPerWorker: typeof filesPerWorker === 'number' ? filesPerWorker : undefined,
  };
}

function resolveMesaConfigPath(configPath?: string): string | null {
  if (configPath) {
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    throw new Error(`Config file not found: ${configPath}`);
  }

  const envPath = process.env.MESA_CONFIG;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const defaultPath = path.resolve(process.cwd(), '.mesa', 'config.yaml');
  if (fs.existsSync(defaultPath)) return defaultPath;

  return null;
}
