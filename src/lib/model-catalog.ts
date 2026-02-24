import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import type { ModelProvider } from './review-model-config.js';
import { findRepoRoot } from './rule-resolution.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelEntry {
  id: string;
  label: string;
  recommended?: boolean;
}

export interface ProviderEntry {
  id: ModelProvider;
  label: string;
  envKey: string;
  models: ModelEntry[];
}

export interface CurrentModel {
  provider: ModelProvider;
  model: string;
}

// ---------------------------------------------------------------------------
// Hardcoded snapshot (fallback when OpenRouter is unreachable)
// ---------------------------------------------------------------------------

const SUPPORTED_PROVIDERS: ProviderEntry[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    envKey: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', recommended: true },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    envKey: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex', recommended: true },
      { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    ],
  },
  {
    id: 'google',
    label: 'Google',
    envKey: 'GOOGLE_API_KEY',
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', recommended: true },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    ],
  },
];

// ---------------------------------------------------------------------------
// models.dev live fetch (canonical model IDs matching provider SDKs)
// ---------------------------------------------------------------------------

const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const FETCH_TIMEOUT_MS = 5_000;

const PROVIDER_IDS: ModelProvider[] = ['anthropic', 'openai', 'google'];

// Our env keys — models.dev uses different names for some providers
const ENV_KEYS: Record<ModelProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
};

const PROVIDER_LABELS: Record<ModelProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
};

interface ModelsDevModel {
  id: string;
  name: string;
  family: string;
  tool_call?: boolean;
  release_date?: string;
}

interface ModelsDevProvider {
  id: string;
  models: Record<string, ModelsDevModel>;
}

type ModelsDevResponse = Record<string, ModelsDevProvider>;

/** True if ID ends with a YYYYMMDD date suffix (e.g. claude-opus-4-5-20251101) */
const DATE_PINNED_RE = /^(.+)-(\d{8})$/;

/** True if ID ends with a YYYY-MM-DD date suffix (e.g. gpt-4o-2024-05-13) */
const DASH_DATE_RE = /^(.+)-(\d{4}-\d{2}-\d{2})$/;

/** Models not useful for code review */
const SKIP_PATTERNS = ['-live-', '-deep-research', '-tts', '-embedding'];

function isDatePinned(id: string): boolean {
  return DATE_PINNED_RE.test(id) || DASH_DATE_RE.test(id);
}

function isReviewCapable(id: string): boolean {
  return !SKIP_PATTERNS.some((p) => id.includes(p));
}

async function fetchModelsDevCatalog(): Promise<ProviderEntry[] | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    const response = await fetch(MODELS_DEV_API_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const json = (await response.json()) as ModelsDevResponse;

    // Build a set of recommended model IDs from the hardcoded snapshot
    const recommendedSet = new Set<string>();
    for (const provider of SUPPORTED_PROVIDERS) {
      for (const model of provider.models) {
        if (model.recommended) {
          recommendedSet.add(`${provider.id}/${model.id}`);
        }
      }
    }

    const result: ProviderEntry[] = [];

    for (const pid of PROVIDER_IDS) {
      const provider = json[pid];
      if (!provider?.models) continue;

      const models: ModelEntry[] = Object.values(provider.models)
        .filter((m) => m.tool_call === true && !isDatePinned(m.id) && isReviewCapable(m.id))
        .sort((a, b) => {
          // Newest first by release_date
          const da = a.release_date ?? '0000-00-00';
          const db = b.release_date ?? '0000-00-00';
          return db.localeCompare(da);
        })
        .map((m) => ({
          id: m.id,
          label: m.name,
          recommended: recommendedSet.has(`${pid}/${m.id}`) || undefined,
        }));

      if (models.length === 0) continue;

      result.push({
        id: pid,
        label: PROVIDER_LABELS[pid],
        envKey: ENV_KEYS[pid],
        models,
      });
    }

    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public catalog API
// ---------------------------------------------------------------------------

export async function getModelCatalog(): Promise<ProviderEntry[]> {
  const live = await fetchModelsDevCatalog();
  return live ?? SUPPORTED_PROVIDERS;
}

export async function getProviderCatalog(provider: ModelProvider): Promise<ProviderEntry | undefined> {
  const catalog = await getModelCatalog();
  return catalog.find((p) => p.id === provider);
}

// ---------------------------------------------------------------------------
// Current model config
// ---------------------------------------------------------------------------

export function getCurrentModel(): CurrentModel | null {
  const repoRoot = findRepoRoot();
  const configPath = path.resolve(repoRoot, '.mesa', 'config.yaml');

  if (!fs.existsSync(configPath)) return null;

  const contents = fs.readFileSync(configPath, 'utf8');
  const raw = yaml.load(contents) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') return null;

  const model = raw.model as { provider?: string; name?: string } | undefined;
  if (!model?.provider || !model?.name) return null;

  return {
    provider: model.provider as ModelProvider,
    model: model.name,
  };
}

// ---------------------------------------------------------------------------
// Set model in config
// ---------------------------------------------------------------------------

export function setModel(provider: ModelProvider, modelName: string, options?: { apiKey?: string }): void {
  const repoRoot = findRepoRoot();
  const configPath = path.resolve(repoRoot, '.mesa', 'config.yaml');

  // Read existing config and preserve other fields
  let existing: Record<string, unknown> = {};
  if (fs.existsSync(configPath)) {
    const contents = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(contents);
    if (parsed && typeof parsed === 'object') {
      existing = parsed as Record<string, unknown>;
    }
  }

  existing.model = { provider, name: modelName };

  const output = yaml.dump(existing, { lineWidth: -1 });
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, output);

  if (options?.apiKey) {
    const envLocalPath = path.resolve(repoRoot, '.env.local');
    const envKey = ENV_KEYS[provider];
    if (envKey) {
      upsertEnvValue(envLocalPath, envKey, options.apiKey);
    }
  }
}

// ---------------------------------------------------------------------------
// API key check
// ---------------------------------------------------------------------------

export function checkApiKey(provider: ModelProvider): boolean {
  const repoRoot = findRepoRoot();
  dotenv.config({ path: path.resolve(repoRoot, '.env.local'), override: false, quiet: true });
  dotenv.config({ path: path.resolve(repoRoot, '.env'), override: false, quiet: true });
  const envKey = ENV_KEYS[provider];
  return !!process.env[envKey];
}

// ---------------------------------------------------------------------------
// Env file helper
// ---------------------------------------------------------------------------

export function upsertEnvValue(filePath: string, key: string, value: string): void {
  const escapedValue = value.replace(/\n/g, '');
  const nextLine = `${key}=${escapedValue}`;
  const exists = fs.existsSync(filePath);
  const content = exists ? fs.readFileSync(filePath, 'utf8') : '';
  const lines = content === '' ? [] : content.split(/\r?\n/);
  const keyPattern = new RegExp(`^\\s*${key}=`);
  const matchIndex = lines.findIndex((line) => keyPattern.test(line));

  if (matchIndex >= 0) {
    lines[matchIndex] = nextLine;
  } else {
    lines.push(nextLine);
  }

  const normalized = `${lines.filter((line) => line.length > 0).join('\n')}\n`;
  fs.writeFileSync(filePath, normalized);
}
