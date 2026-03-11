import fs from 'node:fs';
import path from 'node:path';
import type { McpSkillFile } from '../../templates/mcp-skills.js';
import type { AgentAdapter } from './types.js';
import { resolveSaguaroSubcommandParts } from './utils.js';

const CODEX_SETTINGS_DIR = '.codex';
const CODEX_CONFIG_FILE = 'config.toml';

function configPath(repoRoot: string): string {
  return path.join(repoRoot, CODEX_SETTINGS_DIR, CODEX_CONFIG_FILE);
}
/** Escape a string for use inside a TOML basic string (double-quoted). */
function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Regex matching a `notify = [...]` line containing "hook" and "notify" tokens (covers both `sag` binary and `node` fallback). */
const SAGUARO_NOTIFY_RE = /^notify\s*=\s*\[.*"hook".*"notify".*\]/m;

/** Regex matching any `notify = ...` line (full line). */
const ANY_NOTIFY_RE = /^notify\s*=.*$/m;

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  readonly label = 'Codex';
  readonly supportsBlockingHooks = false;
  readonly settingsDir = CODEX_SETTINGS_DIR;
  readonly skillsDir: string | null = null;

  installHooks(repoRoot: string): void {
    const filePath = configPath(repoRoot);
    let content = '';
    if (fs.existsSync(filePath)) {
      content = fs.readFileSync(filePath, 'utf8');
    }

    if (SAGUARO_NOTIFY_RE.test(content)) {
      return;
    }

    const parts = resolveSaguaroSubcommandParts('hook notify');
    const tomlArray = parts.map((p) => `"${escapeTomlString(p)}"`).join(', ');
    const notifyLine = `notify = [${tomlArray}]`;

    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    let newContent: string;
    if (ANY_NOTIFY_RE.test(content)) {
      // Replace existing notify line to avoid duplicate TOML keys
      newContent = content.replace(ANY_NOTIFY_RE, () => notifyLine);
    } else {
      const trimmed = content.trimEnd();
      newContent = trimmed ? `${trimmed}\n\n${notifyLine}\n` : `${notifyLine}\n`;
    }
    fs.writeFileSync(filePath, newContent);
  }

  uninstallHooks(repoRoot: string): void {
    const filePath = configPath(repoRoot);
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const filtered = lines.filter((line) => !SAGUARO_NOTIFY_RE.test(line));
    const result = filtered.join('\n');

    fs.writeFileSync(filePath, result);
  }

  writeSkills(_repoRoot: string, _skills: McpSkillFile[]): void {
    // No-op: Codex has no skills concept
  }
}
