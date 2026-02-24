import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { anyFileMatchesGlob, detectEcosystems } from '../../lib/detect-ecosystems.js';
import { writeMesaRuleFile } from '../../lib/mesa-rules.js';
import { getModelCatalog, upsertEnvValue } from '../../lib/model-catalog.js';
import type { ModelProvider } from '../../lib/review-model-config.js';
import { findRepoRoot } from '../../lib/rule-resolution.js';
import { selectStarterRules } from '../../lib/select-starter-rules.js';
import { getMcpJsonConfig } from '../../mcp/config.js';
import { ECOSYSTEM_REGISTRY } from '../../templates/ecosystems.js';
import { getMcpSkillFiles } from '../../templates/mcp-skills.js';
import { STARTER_RULES } from '../../templates/starter-rules.js';
import { generateRulesCommand } from './generate.js';
import { installHook } from './hook.js';
import { ask, askChoice, createReadline } from './prompt.js';

const mesaDir = '.mesa';
const skillsDir = '.claude/skills';
const configPath = path.join(mesaDir, 'config.yaml');
const envLocalPath = '.env.local';
const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');

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

  const catalog = await getModelCatalog();

  const rl1 = createReadline();
  let selectedProvider: ModelProvider;
  try {
    const providerChoice = await askChoice(
      rl1,
      secondary('Which AI provider would you like to use?'),
      catalog.map((p) => ({ id: p.id, label: p.label }))
    );
    selectedProvider = providerChoice.id;
  } finally {
    rl1.close();
  }

  const providerConfig = catalog.find((p) => p.id === selectedProvider)!;

  const rl2 = createReadline();
  let selectedModel: string;
  try {
    const modelOptions = [
      ...providerConfig.models.map((m) => ({
        id: m.id,
        label: m.recommended ? `${m.label} (recommended)` : m.label,
      })),
      { id: 'custom' as const, label: 'Custom model name' },
    ];
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
    const detected = detectEcosystems(repoRoot);
    const selected = selectStarterRules(STARTER_RULES, detected, (globs) => anyFileMatchesGlob(repoRoot, globs));

    for (const rule of selected) {
      writeMesaRuleFile(repoRoot, rule);
    }

    const ecoLabels = ECOSYSTEM_REGISTRY.filter((e) => detected.has(e.id))
      .map((e) => e.label)
      .join(', ');

    const ecoSuffix = ecoLabels ? ` (${ecoLabels})` : '';
    console.log(
      chalk.gray(
        `  Applied ${selected.length} starter rules${ecoSuffix}. Add more with ${tertiary('mesa rules create')}.`
      )
    );
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
  console.log(chalk.gray(`  Created: ${relSkillsDir}/mesa-model/`));
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
