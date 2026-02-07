import fs from 'node:fs';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import yaml from 'js-yaml';

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

const VALID_PROVIDERS = ['anthropic', 'openai', 'google'];

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

  if (!VALID_PROVIDERS.includes(provider)) {
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

export function resolveModel(config: MesaConfig): LanguageModel {
  const provider = config.model?.provider ?? 'anthropic';
  const name = config.model?.name ?? 'claude-sonnet-4-5';
  const apiKey = resolveApiKey(config);

  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey })(name);
    case 'openai':
      return createOpenAI({ apiKey })(name);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(name);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

function resolveMesaConfigPath(configPath?: string): string | null {
  if (configPath && fs.existsSync(configPath)) return configPath;

  const envPath = process.env.MESA_CONFIG;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const defaultPath = path.resolve(process.cwd(), '.mesa', 'config.yaml');
  if (fs.existsSync(defaultPath)) return defaultPath;

  return null;
}
