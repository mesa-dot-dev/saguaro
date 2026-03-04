import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { isCliAuthenticated } from '../../ai/agent-runner.js';
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
import { getMcpSkillFiles } from '../../templates/mcp-skills.js';
import { STARTER_RULES } from '../../templates/starter-rules.js';
import { generateRulesCommand } from './generate.js';
import { installHook } from './hook.js';
import { ask, askChoice, askYesNo, createReadline } from './prompt.js';

const mesaDir = '.mesa';
const skillsDir = '.claude/skills';
const configPath = path.join(mesaDir, 'config.yaml');
const envLocalPath = '.env.local';
const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');

type SkillSetupChoice = 'default' | 'generate' | 'skip';

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

  let selectedProvider: ModelProvider;
  let selectedModel: string;
  let wroteApiKey = false;

  if (isCliAuthenticated('claude')) {
    console.log(secondary('  Detected Claude Code: Mesa will use existing subscription\n'));
    selectedProvider = 'anthropic';
    selectedModel = CLI_DEFAULT_MODELS.anthropic;
  } else if (isCliAuthenticated('codex')) {
    console.log(secondary('  Detected Codex CLI: Mesa will use existing subscription\n'));
    selectedProvider = 'openai';
    selectedModel = CLI_DEFAULT_MODELS.openai;
  } else if (isCliAuthenticated('gemini')) {
    console.log(secondary('  Detected Gemini CLI: Mesa will use existing subscription\n'));
    selectedProvider = 'google';
    selectedModel = CLI_DEFAULT_MODELS.google;
  } else {
    // No CLI auth detected — ask for provider and API key only
    console.log(chalk.gray('  No authenticated CLI detected (Claude Code, Codex, Gemini).\n'));
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

    console.log(chalk.gray(`  Using ${recommendedModel.label} (change anytime in .mesa/config.yaml)\n`));
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
    enableDaemon = await askYesNo(rl5, secondary('\nWould you like to automatically review changes as you code?'));
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

  // Write .mcp.json for Claude Code auto-discovery
  writeMcpJson();

  // Write MCP skill files for slash commands
  writeMcpSkills(path.resolve(process.cwd(), skillsDir));

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
