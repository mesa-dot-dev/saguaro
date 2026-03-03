import fs from 'node:fs';
import path from 'node:path';
import { upsertEnvValue } from '../config/env.js';
import type { ModelProvider } from '../config/model-config.js';
import { findRepoRoot } from '../git/git.js';
import { getMcpJsonConfig } from '../mcp/config.js';
import { anyFileMatchesGlob, detectEcosystems } from '../rules/detect-ecosystems.js';
import { writeMesaRuleFile } from '../rules/mesa-rules.js';
import { selectStarterRules } from '../rules/starter.js';
import { getMcpSkillFiles } from '../templates/mcp-skills.js';
import { STARTER_RULES } from '../templates/starter-rules.js';
import { runInstallHook } from './hook.js';

const MESA_DIR = '.mesa';
const SKILLS_DIR = '.claude/skills';
const CONFIG_PATH = path.join(MESA_DIR, 'config.yaml');
const ENV_LOCAL_PATH = '.env.local';
const MCP_JSON_PATH = '.mcp.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InitProjectOptions {
  provider: ModelProvider;
  model: string;
  apiKey?: string;
  ruleStrategy: 'default' | 'generate' | 'skip';
  force?: boolean;
}

export interface InitProjectResult {
  configPath: string;
  rulesDir: string;
  rulesCreated: string[];
  hooksInstalled: boolean;
  mcpConfigPath: string;
  skillsWritten: string[];
  envUpdated: boolean;
  alreadyInitialized: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  max_steps: 10

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

function writeMcpJson(repoRoot: string): void {
  const fullPath = path.resolve(repoRoot, MCP_JSON_PATH);
  const content = JSON.stringify(getMcpJsonConfig(), null, 2);
  fs.writeFileSync(fullPath, `${content}\n`);
}

function writeMcpSkills(skillsDirPath: string): string[] {
  const written: string[] = [];
  for (const skill of getMcpSkillFiles()) {
    const fullPath = path.join(skillsDirPath, skill.skillFilePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, skill.content);
    written.push(skill.skillFilePath);
  }
  return written;
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

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export async function initProject(options: InitProjectOptions): Promise<InitProjectResult> {
  const { provider, model, apiKey, ruleStrategy, force } = options;
  const repoRoot = findRepoRoot();
  const rootMesaDir = path.join(repoRoot, MESA_DIR);
  const rootSkillsDir = path.join(repoRoot, SKILLS_DIR);
  const rulesDir = path.join(repoRoot, MESA_DIR, 'rules');

  if (fs.existsSync(rootMesaDir) && !force) {
    return {
      configPath: path.join(repoRoot, CONFIG_PATH),
      rulesDir,
      rulesCreated: [],
      hooksInstalled: false,
      mcpConfigPath: path.join(repoRoot, MCP_JSON_PATH),
      skillsWritten: [],
      envUpdated: false,
      alreadyInitialized: true,
    };
  }

  // Create directories
  fs.mkdirSync(rootMesaDir, { recursive: true });
  fs.mkdirSync(rootSkillsDir, { recursive: true });

  // Write config
  fs.writeFileSync(path.join(repoRoot, CONFIG_PATH), buildConfigContent(provider, model));

  // Ensure .mesa/history/ is gitignored
  ensureMesaGitignore(repoRoot);

  // Write API key if provided
  const envUpdated = !!apiKey;
  if (apiKey) {
    const { getProviderCatalog } = await import('../config/catalog.js');
    const providerEntry = await getProviderCatalog(provider);
    if (providerEntry) {
      upsertEnvValue(path.join(repoRoot, ENV_LOCAL_PATH), providerEntry.envKey, apiKey);
    }
  }

  // Write .mcp.json
  writeMcpJson(repoRoot);

  // Write MCP skill files
  const skillsWritten = writeMcpSkills(rootSkillsDir);

  // Handle rules
  const rulesCreated: string[] = [];
  if (ruleStrategy === 'default') {
    const detected = detectEcosystems(repoRoot);
    const selected = selectStarterRules(STARTER_RULES, detected, (globs) => anyFileMatchesGlob(repoRoot, globs));
    for (const rule of selected) {
      writeMesaRuleFile(repoRoot, rule);
      rulesCreated.push(rule.id);
    }
  }
  // 'generate' is NOT handled here — caller should invoke generate flow separately
  // 'skip' does nothing

  // Install hooks
  await runInstallHook();

  return {
    configPath: path.join(repoRoot, CONFIG_PATH),
    rulesDir,
    rulesCreated,
    hooksInstalled: true,
    mcpConfigPath: path.join(repoRoot, MCP_JSON_PATH),
    skillsWritten,
    envUpdated,
    alreadyInitialized: false,
  };
}
