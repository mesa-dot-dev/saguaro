import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { writeMesaRuleFile } from '../../lib/mesa-rules.js';
import type { ModelProvider } from '../../lib/review-model-config.js';
import { findRepoRoot } from '../../lib/rule-resolution.js';
import { getMcpJsonConfig } from '../../mcp/config.js';
import { getMcpSkillFiles } from '../../templates/mcp-skills.js';
import { STARTER_RULE_SKILLS } from '../../templates/starter-rule-skills.js';
import { generateRulesCommand } from './generate.js';
import { installHook } from './hook.js';
import { ask, askChoice, createReadline } from './prompt.js';

const mesaDir = '.mesa';
const skillsDir = '.claude/skills';
const configPath = path.join(mesaDir, 'config.yaml');
const envLocalPath = '.env.local';
const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');

interface ProviderModelOption {
  id: string;
  label: string;
}

interface ProviderConfig {
  envKey: string;
  label: string;
  models: ProviderModelOption[];
}

const PROVIDER_REGISTRY: Record<ModelProvider, ProviderConfig> = {
  anthropic: {
    envKey: 'ANTHROPIC_API_KEY',
    label: 'Anthropic',
    models: [
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (recommended)' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    ],
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    label: 'OpenAI',
    models: [
      { id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex (recommended)' },
      { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
    ],
  },
  google: {
    envKey: 'GOOGLE_API_KEY',
    label: 'Google',
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (recommended)' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    ],
  },
};

const CUSTOM_MODEL_OPTION = { id: 'custom', label: 'Custom model name' } as const;

type SkillSetupChoice = 'default' | 'generate' | 'skip';

function buildConfigContent(provider: ModelProvider, modelName: string): string {
  return `# Mesa Configuration
# =============================================================================
# Model Configuration
# =============================================================================
# The AI model to use for reviews. Set API keys in your environment
# (.env.local, .env, or shell export).

model:
  provider: ${provider}
  name: ${modelName}

# =============================================================================
# Output Configuration
# =============================================================================

output:
  # Print Cursor deeplink when violations are found
  cursor_deeplink: true

# =============================================================================
# Review Settings
# =============================================================================

review:
  # Maximum tool-calling steps per review batch
  max_steps: 50

  # Number of files per review batch
  files_per_batch: 2

# =============================================================================
# Hook Settings
# =============================================================================

hook:
  # Master switch for all Mesa hooks
  enabled: true

  # Stop hook: full LLM review after Claude finishes writing code
  # The PreToolUse hook injects rules proactively, so this is opt-in
  stop:
    enabled: false
`;
}

function upsertEnvValue(filePath: string, key: string, value: string): void {
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

const mcpJsonPath = '.mcp.json';

function writeMcpJson(): void {
  const fullPath = path.resolve(process.cwd(), mcpJsonPath);
  const content = JSON.stringify(getMcpJsonConfig(), null, 2);
  fs.writeFileSync(fullPath, `${content}\n`);
}

function writeMcpSkills(skillsDirPath: string): void {
  for (const skill of getMcpSkillFiles()) {
    const fullPath = path.join(skillsDirPath, skill.skillFilePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, skill.content);
  }
}

function ensureMesaGitignore(repoRoot: string): void {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const entry = '.mesa/history/';
  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';

  if (content.includes(entry)) return;

  const trimmed = content.trimEnd();
  content = trimmed.length > 0 ? `${trimmed}\n${entry}\n` : `${entry}\n`;
  fs.writeFileSync(gitignorePath, content, 'utf8');
}

const initHandler = async (argv: { force?: boolean }): Promise<number> => {
  const { force } = argv;
  const repoRoot = findRepoRoot();
  const rootMesaDir = path.join(repoRoot, mesaDir);
  const rootSkillsDir = path.join(repoRoot, skillsDir);

  if (fs.existsSync(rootMesaDir) && !force) {
    console.log(chalk.red(`Mesa already initialized in this directory. Use ${secondary('--force')} to overwrite.`));
    return 1;
  }

  fs.mkdirSync(rootMesaDir, { recursive: true });
  fs.mkdirSync(rootSkillsDir, { recursive: true });
  const rl1 = createReadline();
  let selectedProvider: ModelProvider;
  try {
    const providerChoice = await askChoice(rl1, secondary('Which AI provider would you like to use?'), [
      { id: 'anthropic' as const, label: PROVIDER_REGISTRY.anthropic.label },
      { id: 'openai' as const, label: PROVIDER_REGISTRY.openai.label },
      { id: 'google' as const, label: PROVIDER_REGISTRY.google.label },
    ]);
    selectedProvider = providerChoice.id;
  } finally {
    rl1.close();
  }

  const providerConfig = PROVIDER_REGISTRY[selectedProvider];

  const rl2 = createReadline();
  let selectedModel: string;
  try {
    const modelOptions = [...providerConfig.models, CUSTOM_MODEL_OPTION];
    const modelChoice = await askChoice(
      rl2,
      secondary('Which model?') + chalk.gray('  (you can change this anytime in .mesa/config.yaml)'),
      modelOptions
    );
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

  const rl3 = createReadline();
  let apiKey = '';
  try {
    const keyInput = await ask(
      rl3,
      secondary(
        `Paste your ${providerConfig.envKey} (or type "n" to skip and set ${providerConfig.envKey} in .env.local, .env)`
      )
    );
    const normalizedInput = keyInput.trim();
    const skippedWithN = normalizedInput.toLowerCase() === 'n';
    apiKey = skippedWithN ? '' : normalizedInput;
  } finally {
    rl3.close();
  }

  const wroteApiKey = apiKey.length > 0;

  // Write config and env before rule generation (config must exist for other commands)
  fs.writeFileSync(path.join(repoRoot, configPath), buildConfigContent(selectedProvider, selectedModel));

  // Ensure .mesa/history/ is gitignored
  ensureMesaGitignore(repoRoot);
  if (wroteApiKey) {
    upsertEnvValue(path.join(repoRoot, envLocalPath), providerConfig.envKey, apiKey);
  }

  // Write .mcp.json for Claude Code auto-discovery
  writeMcpJson();

  // Write MCP skill files for slash commands
  writeMcpSkills(path.resolve(process.cwd(), skillsDir));

  const rl4 = createReadline();
  let skillSetupChoice: SkillSetupChoice;
  try {
    const choice = await askChoice(rl4, secondary('How would you like to set up review rules?'), [
      { id: 'generate', label: 'Generate rules from your codebase' },
      { id: 'default', label: 'Use Mesa starter rules' },
      { id: 'skip', label: 'Skip and create rules manually' },
    ] as const);
    skillSetupChoice = choice.id;
  } finally {
    rl4.close();
  }

  if (skillSetupChoice === 'default') {
    for (const starter of STARTER_RULE_SKILLS) {
      writeMesaRuleFile(repoRoot, starter);
    }
    console.log(chalk.gray(`  Added starter rules to .mesa/rules/. Add more with ${tertiary('mesa rules create')}.`));
  } else if (skillSetupChoice === 'generate') {
    await generateRulesCommand({ config: path.join(repoRoot, configPath) });
  } else {
    console.log(chalk.gray(`  Specify your rules with ${secondary('mesa rules create')}.`));
  }

  await installHook();
  const relMesaDir = path.relative(process.cwd(), rootMesaDir) || mesaDir;
  const relSkillsDir = path.relative(process.cwd(), rootSkillsDir) || skillsDir;
  const relEnvPath = path.relative(process.cwd(), path.join(repoRoot, envLocalPath)) || envLocalPath;

  const relRulesDir = path.relative(process.cwd(), path.join(repoRoot, '.mesa', 'rules')) || '.mesa/rules';

  console.log(secondary('\nMesa initialized successfully!'));
  console.log(chalk.gray(`  Created: ${relMesaDir}/config.yaml`));
  console.log(chalk.gray(`  Created: ${relRulesDir}/`));
  console.log(chalk.gray(`  Created: ${mcpJsonPath}`));
  console.log(chalk.gray(`  Created: ${relSkillsDir}/mesa-review/`));
  console.log(chalk.gray(`  Created: ${relSkillsDir}/mesa-createrule/`));
  console.log(chalk.gray(`  Created: ${relSkillsDir}/mesa-generaterules/`));
  console.log(chalk.gray(`  Updated: .claude/settings.json (PreToolUse + Stop hooks)`));
  if (wroteApiKey) {
    console.log(chalk.gray(`  Updated: ${relEnvPath} (${providerConfig.envKey})`));
  } else {
    console.log(chalk.gray(`  Add ${providerConfig.envKey} in your environment (.env.local, .env).`));
  }
  console.log(secondary(`\nRun ${tertiary('mesa review')} to review your changes.`));

  return 0;
};

export default initHandler;
