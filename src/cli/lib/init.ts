import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { getDetectedAdapters } from '../../adapter/agents/index.js';
import { getModelCatalog } from '../../config/catalog.js';
import { buildConfigContent, CLI_DEFAULT_MODELS } from '../../config/config-template.js';
import { upsertEnvValue } from '../../config/env.js';
import type { ModelProvider } from '../../config/model-config.js';
import { findRepoRoot } from '../../git/git.js';
import { getMcpJsonConfig } from '../../mcp/config.js';
import { anyFileMatchesGlob, detectEcosystems } from '../../rules/detect-ecosystems.js';
import { writeMesaRuleFile } from '../../rules/mesa-rules.js';
import { selectStarterRules } from '../../rules/starter.js';
import { ECOSYSTEM_REGISTRY } from '../../templates/ecosystems.js';
import { STARTER_RULES } from '../../templates/starter-rules.js';
import { generateRulesCommand } from './generate.js';
import { installHook } from './hook.js';
import { ask, askChoice, askYesNo, createReadline } from './prompt.js';

const mesaDir = '.mesa';
const configPath = path.join(mesaDir, 'config.yaml');
const envLocalPath = '.env.local';
const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');

/** prioritize claude, then codex, then gemini. */
const AGENT_PROVIDER_MAP: Record<string, { provider: ModelProvider; label: string }> = {
  claude: { provider: 'anthropic', label: 'Claude Code' },
  codex: { provider: 'openai', label: 'Codex' },
  gemini: { provider: 'google', label: 'Gemini' },
};

type SkillSetupChoice = 'default' | 'generate' | 'skip';

const mcpJsonPath = '.mcp.json';

function writeMcpJson(): void {
  const fullPath = path.resolve(process.cwd(), mcpJsonPath);
  const content = JSON.stringify(getMcpJsonConfig(), null, 2);
  fs.writeFileSync(fullPath, `${content}\n`);
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

  if (fs.existsSync(rootMesaDir) && !force) {
    console.log(chalk.red(`Mesa already initialized in this directory. Use ${secondary('--force')} to overwrite.`));
    return 1;
  }

  fs.mkdirSync(rootMesaDir, { recursive: true });

  // Detect all authenticated coding agents (single source of truth, ordered by priority)
  const detected = getDetectedAdapters();

  let selectedProvider: ModelProvider;
  let selectedModel: string;
  let wroteApiKey = false;

  if (detected.length > 0) {
    const agentNames = detected.map((a) => a.label).join(', ');
    console.log(secondary(`  Detected ${detected.length} agent${detected.length > 1 ? 's' : ''}: ${agentNames}`));
    console.log(chalk.gray('  Mesa will integrate with all detected agents.\n'));

    // Auto-pick provider from the highest-priority detected agent
    const chosen = AGENT_PROVIDER_MAP[detected[0].id];
    selectedProvider = chosen.provider;
    selectedModel = CLI_DEFAULT_MODELS[chosen.provider];
    console.log(chalk.gray(`  Using ${chosen.label} for AI reviews. Change anytime with ${tertiary('mesa model')}.\n`));
  } else {
    // No CLI auth detected, then ask for provider and API key
    console.log(chalk.gray('  No coding agents detected (Claude Code, Codex, Gemini).\n'));
    const catalog = await getModelCatalog();

    const rl1 = createReadline();
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
    const recommendedModel = providerConfig.models.find((m) => m.recommended) ?? providerConfig.models[0];
    selectedModel = recommendedModel.id;

    const rl2 = createReadline();
    try {
      const keyInput = await ask(
        rl2,
        secondary(`Paste your ${providerConfig.envKey} (or type "n" to skip and set it in .env.local later)`)
      );
      const normalizedInput = keyInput.trim();
      const skippedWithN = normalizedInput.toLowerCase() === 'n';
      const apiKey = skippedWithN ? '' : normalizedInput;
      wroteApiKey = apiKey.length > 0;
      if (wroteApiKey) {
        upsertEnvValue(path.join(repoRoot, envLocalPath), providerConfig.envKey, apiKey);
      }
    } finally {
      rl2.close();
    }

    console.log(chalk.gray(`  Using ${recommendedModel.label}`));
  }

  // Collect remaining preferences before writing any files
  const rl4 = createReadline();
  let skillSetupChoice: SkillSetupChoice;
  try {
    const choice = await askChoice(
      rl4,
      secondary('How would you like to set up review rules? (you can always add rules later)'),
      [
        { id: 'generate', label: 'Generate rules from your codebase' },
        { id: 'default', label: 'Use Mesa starter rules' },
        { id: 'skip', label: 'Skip and create rules manually' },
      ] as const
    );
    skillSetupChoice = choice.id;
  } finally {
    rl4.close();
  }

  const rl5 = createReadline();
  let enableDaemon = false;
  try {
    enableDaemon = await askYesNo(rl5, chalk.bold(secondary('\nRun Mesa reviews in the background?')));
  } finally {
    rl5.close();
  }

  // All preferences collected — write config once
  fs.writeFileSync(
    path.join(repoRoot, configPath),
    buildConfigContent({ provider: selectedProvider, model: selectedModel, daemon: enableDaemon })
  );

  // Ensure .mesa/history/ is gitignored
  ensureMesaGitignore(repoRoot);

  // Write .mcp.json (agent-agnostic, read by Claude/Gemini/Codex)
  writeMcpJson();

  if (skillSetupChoice === 'default') {
    const detectedEcosystems = detectEcosystems(repoRoot);
    const selected = selectStarterRules(STARTER_RULES, detectedEcosystems, (globs) =>
      anyFileMatchesGlob(repoRoot, globs)
    );

    for (const rule of selected) {
      writeMesaRuleFile(repoRoot, rule);
    }

    const ecoLabels = ECOSYSTEM_REGISTRY.filter((e) => detectedEcosystems.has(e.id))
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
    console.log(chalk.gray(`Specify your rules with ${secondary('mesa rules create')}.`));
  }

  await installHook();
  const relMesaDir = path.relative(process.cwd(), rootMesaDir) || mesaDir;
  const relEnvPath = path.relative(process.cwd(), path.join(repoRoot, envLocalPath)) || envLocalPath;

  const relRulesDir = path.relative(process.cwd(), path.join(repoRoot, '.mesa', 'rules')) || '.mesa/rules';

  console.log(secondary('\nMesa initialized successfully!'));
  console.log(chalk.gray(`  Created: ${relMesaDir}/config.yaml`));
  console.log(chalk.gray(`  Created: ${relRulesDir}/`));
  console.log(chalk.gray(`  Created: ${mcpJsonPath}`));
  for (const adapter of detected) {
    const hookType = adapter.supportsBlockingHooks ? 'blocking hooks' : 'notify hook';
    if (adapter.skillsDir) {
      console.log(chalk.gray(`  ${adapter.label}: skills + ${hookType}`));
    } else {
      console.log(chalk.gray(`  ${adapter.label}: ${hookType}`));
    }
  }
  if (enableDaemon) {
    console.log(chalk.gray('  Enabled: automatic reviews'));
  }
  if (wroteApiKey) {
    console.log(chalk.gray(`  Updated: ${relEnvPath}`));
  }
  console.log(secondary(`\nRun ${tertiary('mesa review')} to review your changes.`));

  return 0;
};

export default initHandler;
