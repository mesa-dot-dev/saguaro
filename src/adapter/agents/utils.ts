import { isSaguaroOnPath, resolveDistBin } from '../../util/resolve-bin.js';

/**
 * Resolve the command string for a sag subcommand.
 * Returns a single shell-safe string (Claude/Gemini hooks).
 * Parts containing spaces are double-quoted.
 */
export function resolveSaguaroSubcommand(subcommand: string): string {
  return resolveSaguaroSubcommandParts(subcommand)
    .map((p) => (p.includes(' ') ? `"${p}"` : p))
    .join(' ');
}

/**
 * Resolve the command parts for a sag subcommand as an array of tokens.
 *
 * Resolution order:
 * 1. `sag` on PATH (Homebrew, npm global, any install)
 * 2. `node` + self-resolved bin.js (npm local, dev checkout)
 */
export function resolveSaguaroSubcommandParts(subcommand: string): string[] {
  if (isSaguaroOnPath()) {
    return ['sag', ...subcommand.split(' ')];
  }
  const distBin = resolveDistBin(import.meta.url);
  return ['node', distBin, ...subcommand.split(' ')];
}
