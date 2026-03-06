import fs from 'node:fs';
import path from 'node:path';
import { findRepoRoot } from '../git/git.js';
import { getMcpSkillFiles } from '../templates/mcp-skills.js';
import { ALL_ADAPTERS, getDetectedAdapters } from './agents/index.js';

export type HookAction = 'install' | 'uninstall';

export interface AgentHookInfo {
  id: string;
  label: string;
  settingsPath: string;
}

export interface HookResult {
  action: HookAction;
  agents: AgentHookInfo[];
}

export async function runInstallHook(): Promise<HookResult> {
  const repoRoot = findRepoRoot();
  const detected = getDetectedAdapters();
  const skills = getMcpSkillFiles();
  const agents: AgentHookInfo[] = detected.map((adapter) => {
    adapter.installHooks(repoRoot);
    adapter.writeSkills(repoRoot, skills);
    return {
      id: adapter.id,
      label: adapter.label,
      settingsPath: path.join(repoRoot, adapter.settingsDir),
    };
  });
  return { action: 'install', agents };
}

export async function runUninstallHook(): Promise<HookResult> {
  const repoRoot = findRepoRoot();
  const agents: AgentHookInfo[] = [];
  for (const adapter of ALL_ADAPTERS) {
    const settingsDir = path.join(repoRoot, adapter.settingsDir);
    if (fs.existsSync(settingsDir)) {
      adapter.uninstallHooks(repoRoot);
      agents.push({
        id: adapter.id,
        label: adapter.label,
        settingsPath: settingsDir,
      });
    }
  }
  return { action: 'uninstall', agents };
}
