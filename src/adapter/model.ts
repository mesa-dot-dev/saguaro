import type { CurrentModel, ProviderEntry } from '../config/catalog.js';
import { getCurrentModel, getModelCatalog, setModel } from '../config/catalog.js';
import { checkApiKey } from '../config/env.js';
import type { ModelProvider } from '../config/model-config.js';

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
