import { isMesaOnPath, resolveDistBin } from '../../util/resolve-bin.js';

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
 *
 * Resolution order:
 * 1. `mesa` on PATH (Homebrew, npm global, any install)
 * 2. `node` + self-resolved bin.js (npm local, dev checkout)
 */
export function resolveMesaSubcommandParts(subcommand: string): string[] {
  if (isMesaOnPath()) {
    return ['mesa', ...subcommand.split(' ')];
  }
  const distBin = resolveDistBin(import.meta.url);
  return ['node', distBin, ...subcommand.split(' ')];
}
