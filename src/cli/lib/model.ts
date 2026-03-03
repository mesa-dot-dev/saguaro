import chalk from 'chalk';
import { getCurrentModel, getModelCatalog, setModel } from '../../config/catalog.js';
import type { ModelProvider } from '../../config/model-config.js';
import { loadValidatedConfig, resolveApiKey } from '../../config/model-config.js';
import { ask, askChoice, createReadline } from './prompt.js';

const secondary = chalk.hex('#be3c00');

const modelHandler = async (): Promise<number> => {
  // Show current model
  const current = getCurrentModel();
  if (current) {
    console.log(chalk.gray(`\nCurrent model: ${secondary(`${current.provider} / ${current.model}`)}\n`));
  } else {
    console.log(chalk.gray('\nNo model configured yet.\n'));
  }

  // Fetch catalog (live with fallback)
  const catalog = await getModelCatalog();

  // 1. Pick provider
  const rl1 = createReadline();
  let selectedProvider: ModelProvider;
  try {
    const providerChoice = await askChoice(
      rl1,
      secondary('Which AI provider?'),
      catalog.map((p) => ({ id: p.id, label: p.label }))
    );
    selectedProvider = providerChoice.id;
  } finally {
    rl1.close();
  }

  // 2. Pick model
  const providerEntry = catalog.find((p) => p.id === selectedProvider)!;
  const rl2 = createReadline();
  let selectedModel: string;
  try {
    const modelOptions = [
      ...providerEntry.models.map((m) => ({
        id: m.id,
        label: m.recommended ? `${m.label} (recommended)` : m.label,
      })),
      { id: 'custom' as const, label: 'Custom model name' },
    ];
    const modelChoice = await askChoice(rl2, secondary('Which model?'), modelOptions);
    if (modelChoice.id === 'custom') {
      selectedModel = await ask(rl2, secondary('Enter model name'));
      if (!selectedModel) {
        console.log(chalk.red('Model name cannot be empty.'));
        return 1;
      }
    } else {
      selectedModel = modelChoice.id;
    }
  } finally {
    rl2.close();
  }

  // 3. Set model
  setModel(selectedProvider, selectedModel);
  console.log(secondary(`\n✓ Model set to ${selectedProvider} / ${selectedModel}`));

  // 4. Check API key — prompt if missing
  try {
    const config = loadValidatedConfig();
    resolveApiKey(config);
  } catch {
    const rl3 = createReadline();
    try {
      const keyInput = await ask(rl3, secondary(`No ${providerEntry.envKey} found. Paste your key (or "n" to skip)`));
      const normalizedInput = keyInput.trim();
      if (normalizedInput.toLowerCase() !== 'n' && normalizedInput.length > 0) {
        setModel(selectedProvider, selectedModel, { apiKey: normalizedInput });
        console.log(secondary('✓ Saved to .env.local'));
      }
    } finally {
      rl3.close();
    }
  }

  console.log(chalk.gray('\n  You can always set this directly in .mesa/config.yaml'));

  return 0;
};

export default modelHandler;
