import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRepoRoot } from '../git/git.js';
import { logger } from './logger.js';

/**
 * Silently migrates .mesa/ directories and config files to .saguaro/.
 * Runs once on CLI startup. Idempotent — skips if .saguaro/ already exists.
 */
export function migrateMesaToSaguaro(): void {
  try {
    migrateHomeDir();
  } catch (err) {
    logger.debug(`[migrate] Home dir migration skipped: ${err}`);
  }

  try {
    migrateProjectDir();
  } catch (err) {
    logger.debug(`[migrate] Project dir migration skipped: ${err}`);
  }
}

function migrateHomeDir(): void {
  const oldDir = path.join(os.homedir(), '.mesa');
  const newDir = path.join(os.homedir(), '.saguaro');

  if (!fs.existsSync(oldDir)) return;
  if (fs.existsSync(newDir)) {
    logger.debug('[migrate] Both ~/.mesa and ~/.saguaro exist — skipping home dir migration');
    return;
  }

  // Check for running daemon via pid file
  const pidFile = path.join(oldDir, 'daemon.pid');
  if (fs.existsSync(pidFile)) {
    try {
      const content = JSON.parse(fs.readFileSync(pidFile, 'utf8'));
      if (content.pid) {
        try {
          process.kill(content.pid, 0); // Check if process exists
          process.kill(content.pid, 'SIGTERM');
          // Brief wait for daemon to release file handles
          const start = Date.now();
          while (Date.now() - start < 2000) {
            try {
              process.kill(content.pid, 0);
            } catch {
              break; // Process exited
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
          }
          logger.debug(`[migrate] Stopped running daemon (PID ${content.pid})`);
        } catch {
          // Process not running, safe to proceed
        }
      }
    } catch {
      // Invalid pid file, safe to proceed
    }
  }

  fs.renameSync(oldDir, newDir);
  console.error('[saguaro] Migrated ~/.mesa to ~/.saguaro');
}

function migrateProjectDir(): void {
  let repoRoot: string;
  try {
    repoRoot = findRepoRoot();
  } catch {
    return; // Not in a git repo
  }

  const oldDir = path.join(repoRoot, '.mesa');
  const newDir = path.join(repoRoot, '.saguaro');

  if (!fs.existsSync(oldDir)) return;
  if (fs.existsSync(newDir)) {
    logger.debug('[migrate] Both .mesa and .saguaro exist — skipping project dir migration');
    return;
  }

  fs.renameSync(oldDir, newDir);
  console.error('[saguaro] Migrated .mesa/ to .saguaro/');

  updateGitignore(repoRoot);
  updateAgentConfigs(repoRoot);
}

function updateGitignore(repoRoot: string): void {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return;

  const content = fs.readFileSync(gitignorePath, 'utf8');
  const updated = content
    .replace(/\.mesa\/config\.yaml/g, '.saguaro/config.yaml')
    .replace(/\.mesa\/history\//g, '.saguaro/history/')
    .replace(/\.mesa\/.tmp\//g, '.saguaro/.tmp/')
    .replace(/\.mesa\//g, '.saguaro/');

  if (updated !== content) {
    fs.writeFileSync(gitignorePath, updated, 'utf8');
    console.error('[saguaro] Updated .gitignore entries');
  }
}

function updateAgentConfigs(repoRoot: string): void {
  const configs = [
    path.join(repoRoot, '.claude', 'settings.json'),
    path.join(repoRoot, '.gemini', 'settings.json'),
    path.join(repoRoot, '.mcp.json'),
  ];

  for (const configPath of configs) {
    if (!fs.existsSync(configPath)) continue;

    const content = fs.readFileSync(configPath, 'utf8');
    // Use specific patterns to avoid corrupting mesa.dev domain or mesa-dot-dev org
    const updated = content
      .replace(/"command":\s*"mesa"/g, '"command": "sag"')
      .replace(/mesa hook pre-tool/g, 'sag hook pre-tool')
      .replace(/mesa hook run/g, 'sag hook run')
      .replace(/mesa serve/g, 'sag serve')
      .replace(/Mesa: reviewing/g, 'Saguaro: reviewing');

    if (updated !== content) {
      fs.writeFileSync(configPath, updated, 'utf8');
      console.error(`[saguaro] Updated ${path.relative(repoRoot, configPath)}`);
    }
  }
}
