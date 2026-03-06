import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { findRepoRoot } from '../../git/git.js';

/**
 * Resolve the command string for a mesa subcommand.
 * Returns a single shell-safe string (Claude/Gemini hooks).
 * Parts containing spaces are double-quoted.
 */
export function resolveMesaSubcommand(subcommand: string): string {
  return resolveMesaSubcommandParts(subcommand)
    .map((p) => (p.includes(' ') ? `"${p}"` : p))
    .join(' ');
}

/**
 * Resolve the command parts for a mesa subcommand as an array of tokens.
 * Each element is a single argument — safe for TOML arrays or spawn-style APIs
 * even when paths contain spaces.
 */
export function resolveMesaSubcommandParts(subcommand: string): string[] {
  try {
    execFileSync('which', ['mesa'], { stdio: 'ignore' });
    return ['mesa', ...subcommand.split(' ')];
  } catch {
    const distBin = path.resolve(findRepoRoot(), 'packages', 'code-review', 'dist', 'cli', 'bin', 'index.js');
    return ['node', distBin, ...subcommand.split(' ')];
  }
}
