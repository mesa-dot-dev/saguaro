import type { CurrentModel, ProviderEntry } from '../lib/model-catalog.js';
import { checkApiKey, getCurrentModel, getModelCatalog, setModel } from '../lib/model-catalog.js';
import type { ModelProvider } from '../lib/review-model-config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelOptions {
  currentModel: CurrentModel | null;
  catalog: ProviderEntry[];
}

export interface SwitchModelOptions {
  provider: ModelProvider;
  model: string;
  apiKey?: string;
}

export interface SwitchModelResult {
  previousModel: string | null;
  newModel: string;
  keyUpdated: boolean;
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

export async function getModelOptions(): Promise<ModelOptions> {
  const currentModel = getCurrentModel();
  const catalog = await getModelCatalog();
  return { currentModel, catalog };
}

export function switchModel(options: SwitchModelOptions): SwitchModelResult {
  const current = getCurrentModel();
  const previousModel = current ? `${current.provider} / ${current.model}` : null;

  setModel(options.provider, options.model, options.apiKey ? { apiKey: options.apiKey } : undefined);

  return {
    previousModel,
    newModel: `${options.provider} / ${options.model}`,
    keyUpdated: !!options.apiKey,
  };
}

export function hasApiKey(provider: ModelProvider): boolean {
  return checkApiKey(provider);
}
