import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { STARTER_RULES } from '../../templates/starter-rules.js';
import { ask, askYesNo, createReadline } from './prompt.js';

const mesaDir = '.mesa';
const rulesDir = path.join(mesaDir, 'rules');
const configPath = path.join(mesaDir, 'config.yaml');
const rulesKeepPath = path.join(rulesDir, '.gitkeep');
const envLocalPath = '.env.local';
const apiKeyEnvName = 'ANTHROPIC_API_KEY';
const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');
const DEFAULT_PROVIDER = 'anthropic';
const DEFAULT_MODEL = 'claude-opus-4-6';

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
  files_per_worker: 3
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

function writeBasicRules(dir: string) {
  for (const filename in STARTER_RULES) {
    const content = STARTER_RULES[filename];
    fs.writeFileSync(path.join(dir, filename), content);
  }
}

const initHandler = async (argv: { force?: boolean }): Promise<number> => {
  const { force } = argv;

  if (fs.existsSync(mesaDir) && !force) {
    console.log(chalk.red(`Mesa already initialized in this directory. Use ${secondary('--force')} to overwrite.`));
    return 1;
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

  // Prompt to set up API key
  const rl2 = createReadline();
  try {
    const keyInput = await ask(
      rl2,
      secondary('Paste your Anthropic API key (or type "n" to skip and set ANTHROPIC_API_KEY in .env.local, .env)')
    );
    const normalizedInput = keyInput.trim();
    const skippedWithN = normalizedInput.toLowerCase() === 'n';
    const apiKey = skippedWithN ? '' : normalizedInput;
    const wroteApiKey = apiKey.length > 0;

    fs.writeFileSync(configPath, buildConfigContent());
    if (wroteApiKey) {
      upsertEnvValue(path.resolve(process.cwd(), envLocalPath), apiKeyEnvName, apiKey);
    }

    console.log(secondary('\nMesa initialized successfully!'));
    console.log(chalk.gray(`  Created: ${configPath}`));
    console.log(chalk.gray(`  Created: ${rulesDir}/`));
    if (wroteApiKey) {
      console.log(chalk.gray(`  Updated: ${envLocalPath} (${apiKeyEnvName})`));
    }
    console.log(secondary(`Specify more rules with ${tertiary('mesa rules create')}.`));
    if (!wroteApiKey) {
      console.log(chalk.gray(`  Add ${apiKeyEnvName} in your environment (.env.local, .env).`));
      if (skippedWithN) {
        console.log(chalk.gray('  You entered "n", so API key setup is manual.'));
      }
    }
  } finally {
    rl2.close();
  }

  return 0;
};

export default initHandler;
