import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { getStarterSkillFiles } from '../../templates/starter-skills.js';
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

type SkillSetupChoice = 'default' | 'skip';

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

const initHandler = async (argv: { force?: boolean }): Promise<number> => {
  const { force } = argv;

  if (fs.existsSync(mesaDir) && !force) {
    console.log(chalk.red(`Mesa already initialized in this directory. Use ${secondary('--force')} to overwrite.`));
    return 1;
  }

  fs.mkdirSync(mesaDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });
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
  fs.writeFileSync(configPath, buildConfigContent());
  if (wroteApiKey) {
    upsertEnvValue(path.resolve(process.cwd(), envLocalPath), apiKeyEnvName, apiKey);
  }

  const rl2 = createReadline();
  let skillSetupChoice: SkillSetupChoice;
  try {
    const choice = await askChoice(rl2, secondary('How would you like to set up review rules?'), [
      { id: 'default', label: 'Use Mesa default starter rules' },
      { id: 'skip', label: 'Skip for now (set up rules later)' },
    ] as const);
    skillSetupChoice = choice.id;
  } finally {
    rl2.close();
  }

  if (skillSetupChoice === 'default') {
    writeStarterSkills(path.resolve(process.cwd(), skillsDir));
    console.log(chalk.gray(`  Added starter rules. Add more with ${tertiary('mesa rules create')}.`));
  } else {
    console.log(chalk.gray(`  Specify your rules with ${secondary('mesa rules create')}.`));
  }

  console.log(secondary('\nMesa initialized successfully!'));
  console.log(chalk.gray(`  Created: ${configPath}`));
  console.log(chalk.gray(`  Created: ${skillsDir}/`));
  if (wroteApiKey) {
    console.log(chalk.gray(`  Updated: ${envLocalPath} (${apiKeyEnvName})`));
  } else {
    console.log(chalk.gray(`  Add ${apiKeyEnvName} in your environment (.env.local, .env).`));
  }
  console.log(secondary(`\nRun ${tertiary('mesa review')} to review your changes.`));

  return 0;
};

export default initHandler;
