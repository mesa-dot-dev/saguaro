import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { findRepoRoot } from '../git/git.js';
import type { ModelProvider } from './model-config.js';

// ---------------------------------------------------------------------------
// Env key mapping
// ---------------------------------------------------------------------------

export const ENV_KEYS: Record<ModelProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
};

export function getEnvKey(provider: ModelProvider): string {
  return ENV_KEYS[provider];
}

// ---------------------------------------------------------------------------
// API key check
// ---------------------------------------------------------------------------

export function checkApiKey(provider: ModelProvider): boolean {
  const repoRoot = findRepoRoot();
  dotenv.config({ path: path.resolve(repoRoot, '.env.local'), override: false, quiet: true });
  dotenv.config({ path: path.resolve(repoRoot, '.env'), override: false, quiet: true });
  const envKey = ENV_KEYS[provider];
  return !!process.env[envKey];
}

// ---------------------------------------------------------------------------
// Env file helper
// ---------------------------------------------------------------------------

export function upsertEnvValue(filePath: string, key: string, value: string): void {
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
