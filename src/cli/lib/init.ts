import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { findRepoRoot } from '../../lib/skills.js';
import { getMcpJsonConfig } from '../../mcp/config.js';
import { getMcpSkillFiles } from '../../templates/mcp-skills.js';
import { getStarterSkillFiles } from '../../templates/starter-skills.js';
import { generateRulesCommand } from './generate.js';
import { installHook } from './hook.js';
import { ask, askChoice, createReadline } from './prompt.js';

const mesaDir = '.mesa';
const skillsDir = '.claude/skills';
const configPath = path.join(mesaDir, 'config.yaml');
const envLocalPath = '.env.local';
const apiKeyEnvName = 'ANTHROPIC_API_KEY';
const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');
const DEFAULT_PROVIDER = 'anthropic' as const;
const DEFAULT_MODEL = 'claude-opus-4-6';

type SkillSetupChoice = 'default' | 'generate' | 'skip';

function buildConfigContent(): string {
  return `# Mesa Configuration
# =============================================================================
# Model Configuration
# =============================================================================
# The AI model to use for reviews. Set API keys in your environment
# (.env.local, .env, or shell export).

model:
  provider: ${DEFAULT_PROVIDER}
  name: ${DEFAULT_MODEL}

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
  # Maximum tool-calling steps per worker
  max_steps_size: 50

  # Number of files to include in each worker batch
  files_per_worker: 2
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

function writeStarterSkills(dir: string) {
  for (const starter of getStarterSkillFiles()) {
    const skillFilePath = path.join(dir, starter.skillFilePath);
    const policyFilePath = path.join(dir, starter.policyFilePath);
    fs.mkdirSync(path.dirname(skillFilePath), { recursive: true });
    fs.mkdirSync(path.dirname(policyFilePath), { recursive: true });
    fs.writeFileSync(skillFilePath, starter.skillMarkdown);
    fs.writeFileSync(policyFilePath, starter.policyYaml);
  }
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
  let apiKey = '';
  try {
    const keyInput = await ask(
      rl1,
      secondary('Paste your Anthropic API key (or type "n" to skip and set ANTHROPIC_API_KEY in .env.local, .env)')
    );
    const normalizedInput = keyInput.trim();
    const skippedWithN = normalizedInput.toLowerCase() === 'n';
    apiKey = skippedWithN ? '' : normalizedInput;
  } finally {
    rl1.close();
  }

  const wroteApiKey = apiKey.length > 0;

  // Write config and env before rule generation (config must exist for other commands)
  fs.writeFileSync(path.join(repoRoot, configPath), buildConfigContent());
  if (wroteApiKey) {
    upsertEnvValue(path.join(repoRoot, envLocalPath), apiKeyEnvName, apiKey);
  }

  // Write .mcp.json for Claude Code auto-discovery
  writeMcpJson();

  // Write MCP skill files for slash commands
  writeMcpSkills(path.resolve(process.cwd(), skillsDir));

  const rl2 = createReadline();
  let skillSetupChoice: SkillSetupChoice;
  try {
    const choice = await askChoice(rl2, secondary('How would you like to set up review rules?'), [
      { id: 'default', label: 'Use Mesa default starter rules' },
      { id: 'generate', label: 'Generate rules from your codebase (AI-powered)' },
      { id: 'skip', label: 'Skip for now (set up rules later)' },
    ] as const);
    skillSetupChoice = choice.id;
  } finally {
    rl2.close();
  }

  if (skillSetupChoice === 'default') {
    writeStarterSkills(rootSkillsDir);
    console.log(chalk.gray(`  Added starter rules. Add more with ${tertiary('mesa rules create')}.`));
  } else if (skillSetupChoice === 'generate') {
    if (wroteApiKey) {
      await generateRulesCommand({ config: path.join(repoRoot, configPath) });
    } else {
      console.log(
        chalk.yellow(
          `  Rule generation requires an API key. Set ${apiKeyEnvName} in .env.local then run ${tertiary('mesa rules generate')}.`
        )
      );
    }
  } else {
    console.log(chalk.gray(`  Specify your rules with ${secondary('mesa rules create')}.`));
  }

  await installHook();
  const relMesaDir = path.relative(process.cwd(), rootMesaDir) || mesaDir;
  const relSkillsDir = path.relative(process.cwd(), rootSkillsDir) || skillsDir;
  const relEnvPath = path.relative(process.cwd(), path.join(repoRoot, envLocalPath)) || envLocalPath;

  console.log(secondary('\nMesa initialized successfully!'));
  console.log(chalk.gray(`  Created: ${relMesaDir}/config.yaml`));
  console.log(chalk.gray(`  Created: ${relSkillsDir}/`));
  console.log(chalk.gray(`  Created: ${mcpJsonPath}`));
  console.log(chalk.gray(`  Created: ${relSkillsDir}/mesa-review/`));
  console.log(chalk.gray(`  Created: ${relSkillsDir}/mesa-createrule/`));
  console.log(chalk.gray(`  Created: ${relSkillsDir}/mesa-generaterules/`));
  console.log(chalk.gray(`  Updated: .claude/settings.json (Claude Code integration)`));
  if (wroteApiKey) {
    console.log(chalk.gray(`  Updated: ${relEnvPath} (${apiKeyEnvName})`));
  } else {
    console.log(chalk.gray(`  Add ${apiKeyEnvName} in your environment (.env.local, .env).`));
  }
  console.log(secondary(`\nRun ${tertiary('mesa review')} to review your changes.`));

  return 0;
};

export default initHandler;
