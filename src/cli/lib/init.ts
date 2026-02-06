import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { STARTER_RULES } from '../../templates/starter-rules.js';

const initHandler = async (argv: { force?: boolean }) => {
  const { force } = argv;
  const mesaDir = '.mesa';
  const configPath = path.join(mesaDir, 'config.yaml');
  const rulesDir = path.join(mesaDir, 'rules');

  if (fs.existsSync(mesaDir) && !force) {
    console.log(chalk.red('Mesa already initialized in this directory. Use --force to overwrite.'));
    process.exit(1);
  }

  fs.mkdirSync(rulesDir, { recursive: true });

  const configContent = `# Mesa Configuration
# =============================================================================
# Model Configuration
# =============================================================================

model:
  provider: anthropic  # anthropic | openai | google
  name: claude-opus-4-6  # claude-opus-4-6 | claude-sonnet-4-5 | gpt-4.1 | gemini-2.5-pro

# =============================================================================
# API Keys
# =============================================================================
# Set your API key here or export ANTHROPIC_API_KEY in your shell.
# Environment variables take priority over config values.

api_keys:
  anthropic: ""
  openai: ""
  google: ""

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
  format: console  # console | json | markdown
  verbose: false

# =============================================================================
# Review Settings
# =============================================================================

review:
  max_files: 50
  timeout_per_file: 60
  max_file_size: 100000
  max_steps_size: 50
`;

  fs.writeFileSync(configPath, configContent);

  for (const [filename, content] of Object.entries(STARTER_RULES)) {
    const rulePath = path.join(rulesDir, filename);
    fs.writeFileSync(rulePath, content);
  }

  console.log(chalk.green(`Mesa initialized successfully!`));
  console.log(`  Created: ${configPath}`);
  console.log(`  Created: ${Object.keys(STARTER_RULES).length} starter rules in ${rulesDir}/`);
  console.log(chalk.gray(`\n  Next steps:`));
  console.log(chalk.gray(`    1. export ANTHROPIC_API_KEY=<your-key>`));
  console.log(chalk.gray(`    2. mesa review --base main`));

  process.exit(0);
};

export default initHandler;
