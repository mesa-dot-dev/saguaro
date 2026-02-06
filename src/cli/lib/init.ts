import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { STARTER_RULES } from '../../templates/starter-rules.js';
import { ask, askChoice, askYesNo, createReadline } from './prompt.js';

const mesaDir = '.mesa';
const rulesDir = path.join(mesaDir, 'rules');
const configPath = path.join(mesaDir, 'config.yaml');
const rulesKeepPath = path.join(rulesDir, '.gitkeep');
const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
] as const;

const MODELS_BY_PROVIDER: Record<string, { id: string; label: string }[]> = {
  anthropic: [
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
    { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [
    { id: 'gpt-5-2', label: 'GPT-5.2' },
    { id: 'gpt-5.3-codex', label: 'GPT-5.3-CODEX' },
  ],
  google: [
    { id: 'GEMINI-3-PRO-PREVIEW', label: 'Gemini 3 Pro' },
    { id: 'GEMINI-3-FLASH-PREVIEW', label: 'Gemini 3 Flash' },
  ],
};

function buildConfigContent(provider: string, modelName: string, apiKey: string): string {
  const keys: Record<string, string> = {
    anthropic: '""',
    openai: '""',
    google: '""',
  };
  if (apiKey && provider in keys) {
    keys[provider] = `"${apiKey.replace(/"/g, '\\"')}"`;
  }

  return `# Mesa Configuration
# =============================================================================
# Model Configuration
# =============================================================================
# The AI model to use for reviews. User must provide their own API key
# via environment variable (ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)

model:
  provider: ${provider}
  name: ${modelName}

# =============================================================================
# API Keys (Optional)
# =============================================================================
# Mesa will export these as environment variables 
# Leave blank to use your shell environment instead.

api_keys:
  anthropic: ${keys.anthropic}
  openai: ${keys.openai}
  google: ${keys.google}

# =============================================================================
# OpenCode (Optional)
# =============================================================================
# Leave url empty to let Mesa start and manage its own OpenCode server.

opencode:
  url: ""

# =============================================================================
# Output Configuration
# =============================================================================

output:
  # Default output format: console | json | markdown
  format: console
  
  # Show detailed progress (useful for debugging)
  verbose: false

  # Print a copy/paste fix prompt when violations are found
  fix_prompt: true

  # Print Cursor deeplinks with a prefilled fix prompt
  cursor_deeplink: true

# =============================================================================
# Review Settings
# =============================================================================

review:
  # Files reviewed by each worker.
  # Set to 1 for one-worker-per-file parallelism.
  files_per_worker: 3

  # Maximum number of files to review in a single run
  max_files: 50
  
  # Timeout per file in seconds
  timeout_per_file: 120
  
  # Skip files larger than this (in bytes)
  max_file_size: 100000

  # Default to 50 steps. 
  max_steps_size: 50 
`;
}

function writeBasicRules(dir: string) {
  for (const filename in STARTER_RULES) {
    const content = STARTER_RULES[filename];
    fs.writeFileSync(path.join(dir, filename), content);
  }
}

const initHandler = async (argv: { force?: boolean }) => {
  const { force } = argv;

  if (fs.existsSync(mesaDir) && !force) {
    console.log(chalk.red(`Mesa already initialized in this directory. Use ${secondary('--force')} to overwrite.`));
    process.exit(1);
  }

  fs.mkdirSync(rulesDir, { recursive: true });
  fs.writeFileSync(rulesKeepPath, '');

  const rl1 = createReadline();
  const wantRules = await askYesNo(rl1, secondary('Would you like Mesa to create some rules for you?'));
  rl1.close();

  if (wantRules) {
    writeBasicRules(path.resolve(process.cwd(), rulesDir));
    console.log(chalk.gray(`  Added 2 basic rules. Add more with ${tertiary('mesa rules create')}.`));
  } else {
    console.log(chalk.gray(`Specify your rules with ${secondary('mesa rules create')}.`));
  }

  // Prompt to set up API keys and model
  const rl2 = createReadline();
  try {
    console.log(
      secondary('Choose a provider and model. You can enter an API key now or use environment variables later.')
    );

    const providerOption = await askChoice(rl2, 'Pick a provider', PROVIDERS);
    const providerId = providerOption.id;

    const models = MODELS_BY_PROVIDER[providerId];
    const modelOption = models?.length
      ? await askChoice(rl2, `Pick a model for ${providerOption.label}`, models)
      : { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' };

    let apiKey = '';
    const enterKey = await askYesNo(rl2, 'Enter API key now? (otherwise set via environment variable later)');
    if (enterKey) {
      apiKey = await ask(rl2, secondary(`Paste your ${providerOption.label} API key`));
    }

    fs.writeFileSync(configPath, buildConfigContent(providerId, modelOption.id, apiKey));

    console.log(secondary('\nMesa initialized successfully!'));
    console.log(chalk.gray(`  Created: ${configPath}`));
    console.log(chalk.gray(`  Created: ${rulesDir}/`));
    console.log(secondary(`Specify more rules with ${tertiary('mesa rules create')}.`));
    if (!apiKey && enterKey === false) {
      console.log(
        chalk.gray(
          `  Set ${providerId.toUpperCase()}_API_KEY in your environment or edit ${configPath} to add your key.`
        )
      );
    }
  } finally {
    rl2.close();
  }

  process.exit(0);
};

export default initHandler;
