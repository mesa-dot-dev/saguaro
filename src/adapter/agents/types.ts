import type { McpSkillFile } from '../../templates/mcp-skills.js';

export interface AgentAdapter {
  readonly id: 'claude' | 'codex' | 'gemini';
  readonly label: string;
  readonly supportsBlockingHooks: boolean;
  /** Path to agent's settings directory relative to repo root (e.g. '.claude') */
  readonly settingsDir: string;
  /** Path to agent's skills directory relative to repo root (e.g. '.claude/skills'). Null if unsupported. */
  readonly skillsDir: string | null;
  installHooks(repoRoot: string): void;
  uninstallHooks(repoRoot: string): void;
  writeSkills(repoRoot: string, skills: McpSkillFile[]): void;
}
