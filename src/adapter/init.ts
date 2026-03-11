import fs from 'node:fs';
import path from 'node:path';
import { buildConfigContent } from '../config/config-template.js';
import { upsertEnvValue } from '../config/env.js';
import type { ModelProvider } from '../config/model-config.js';
import { findRepoRoot } from '../git/git.js';
import { getMcpJsonConfig } from '../mcp/config.js';
import { anyFileMatchesGlob, detectEcosystems } from '../rules/detect-ecosystems.js';
import { writeSaguaroRuleFile } from '../rules/saguaro-rules.js';
import { selectStarterRules } from '../rules/starter.js';
import { getMcpSkillFiles } from '../templates/mcp-skills.js';
import { STARTER_RULES } from '../templates/starter-rules.js';
import { getDetectedAdapters } from './agents/index.js';
import { runInstallHook } from './hook.js';

const SAGUARO_DIR = '.saguaro';
const CONFIG_PATH = path.join(SAGUARO_DIR, 'config.yaml');
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
  daemon?: boolean;
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

function writeMcpJson(repoRoot: string): void {
  const fullPath = path.resolve(repoRoot, MCP_JSON_PATH);
  const content = JSON.stringify(getMcpJsonConfig(), null, 2);
  fs.writeFileSync(fullPath, `${content}\n`);
}

function ensureSaguaroGitignore(repoRoot: string): void {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const entries = ['.saguaro/config.yaml', '.saguaro/history/', '.mcp.json'];
  let content = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf8') : '';

  const missing = entries.filter((e) => !content.includes(e));
  if (missing.length === 0) return;

  const trimmed = content.trimEnd();
  content = trimmed.length > 0 ? `${trimmed}\n${missing.join('\n')}\n` : `${missing.join('\n')}\n`;
  fs.writeFileSync(gitignorePath, content, 'utf8');
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export async function initProject(options: InitProjectOptions): Promise<InitProjectResult> {
  const { provider, model, apiKey, ruleStrategy, daemon, force } = options;
  const repoRoot = findRepoRoot();
  const rootSaguaroDir = path.join(repoRoot, SAGUARO_DIR);
  const rulesDir = path.join(repoRoot, SAGUARO_DIR, 'rules');

  if (fs.existsSync(rootSaguaroDir) && !force) {
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
  fs.mkdirSync(rootSaguaroDir, { recursive: true });

  // Write config
  fs.writeFileSync(path.join(repoRoot, CONFIG_PATH), buildConfigContent({ provider, model, daemon: daemon ?? false }));

  // Ensure .saguaro/history/ is gitignored
  ensureSaguaroGitignore(repoRoot);

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

  // Write MCP skill files for all detected agents
  const detected = getDetectedAdapters();
  const skills = getMcpSkillFiles();
  const skillsWritten: string[] = [];
  for (const adapter of detected) {
    adapter.writeSkills(repoRoot, skills);
    if (adapter.skillsDir) {
      for (const skill of skills) {
        skillsWritten.push(path.join(adapter.skillsDir, skill.skillFilePath));
      }
    }
  }

  // Handle rules
  const rulesCreated: string[] = [];
  if (ruleStrategy === 'default') {
    const detectedEcosystems = detectEcosystems(repoRoot);
    const selected = selectStarterRules(STARTER_RULES, detectedEcosystems, (globs) =>
      anyFileMatchesGlob(repoRoot, globs)
    );
    for (const rule of selected) {
      writeSaguaroRuleFile(repoRoot, rule);
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
