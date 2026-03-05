import { exitTui } from './exit.js';
import type { Route } from './router.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  category: 'review' | 'rules' | 'config' | 'system';
  args?: string;
  subcommands?: string[];
  route: Route | ((args: string[]) => Route | null);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

function parseReviewArgs(args: string[]): Route {
  let baseRef: string | undefined;
  let headRef: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--base' || arg === '-b') && args[i + 1]) {
      baseRef = args[++i];
    } else if (arg === '--head' && args[i + 1]) {
      headRef = args[++i];
    } else if (!arg.startsWith('-') && !baseRef) {
      baseRef = arg;
    } else if (!arg.startsWith('-') && baseRef && !headRef) {
      headRef = arg;
    }
  }

  return { screen: 'review', baseRef, headRef };
}

export const commands: Command[] = [
  {
    name: 'review',
    description: 'Run reviews and build index',
    category: 'review',
    subcommands: ['local', 'classic', 'full', 'branch', 'index'],
    route: (args) => {
      const sub = args[0];
      if (!sub) return { screen: 'review-hub' };
      if (sub === 'local') return { ...parseReviewArgs(args.slice(1)), mode: undefined };
      if (sub === 'classic') return { ...parseReviewArgs(args.slice(1)), mode: 'classic' as const };
      if (sub === 'full') return { ...parseReviewArgs(args.slice(1)), mode: 'full' as const };
      if (sub === 'branch') return parseReviewArgs(args.slice(1));
      if (sub === 'index') return { screen: 'index' };
      // Treat unrecognized args as review flags (e.g. /review --base X)
      return parseReviewArgs(args);
    },
  },
  {
    name: 'rules',
    description: 'Rules hub — list, create, generate, validate',
    category: 'rules',
    subcommands: ['list', 'create', 'generate', 'validate', 'explain', 'delete'],
    route: (args) => {
      const sub = args[0];
      if (!sub) return { screen: 'rules' };
      switch (sub) {
        case 'list':
          return { screen: 'rules-list' };
        case 'create':
          return { screen: 'rules-create' };
        case 'generate':
          return { screen: 'rules-generate' };
        case 'validate':
          return { screen: 'rules-validate' };
        case 'explain':
          return args[1] ? { screen: 'rules-explain', ruleId: args[1] } : null;
        case 'delete':
          return args[1] ? { screen: 'rules-delete', ruleId: args[1] } : null;
        default:
          return null;
      }
    },
  },
  {
    name: 'model',
    description: 'Switch AI model',
    category: 'config',
    route: { screen: 'model' },
  },
  {
    name: 'stats',
    description: 'View review analytics',
    category: 'config',
    route: { screen: 'stats' },
  },
  {
    name: 'configure',
    aliases: ['config'],
    description: 'Index, hooks, and project setup',
    category: 'config',
    subcommands: ['index', 'hook', 'init'],
    route: (args) => {
      const sub = args[0];
      if (sub === 'index') return { screen: 'index' };
      if (sub === 'init') return { screen: 'init' };
      if (sub === 'hook') {
        const action = args[1];
        if (action === 'install' || action === 'uninstall') {
          return { screen: 'hook', action };
        }
        return { screen: 'hook' };
      }
      return { screen: 'configure' };
    },
  },
  {
    name: 'init',
    description: 'Set up Mesa in your repo',
    category: 'config',
    route: { screen: 'init' },
  },
  {
    name: 'index',
    description: 'Build the codebase import graph',
    category: 'config',
    route: { screen: 'index' },
  },
  {
    name: 'hook',
    description: 'Manage Claude Code hooks',
    category: 'config',
    subcommands: ['install', 'uninstall'],
    route: (args) => {
      const sub = args[0];
      if (sub === 'install' || sub === 'uninstall') {
        return { screen: 'hook', action: sub };
      }
      return { screen: 'hook' };
    },
  },
  {
    name: 'help',
    aliases: ['?'],
    description: 'Show all commands',
    category: 'system',
    route: { screen: 'help' },
  },
  {
    name: 'quit',
    aliases: ['q'],
    description: 'Exit Mesa',
    category: 'system',
    route: () => {
      exitTui();
      return null;
    },
  },
];

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseCommand(input: string): Route | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();
  if (!name) return null;

  const args = parts.slice(1);

  const cmd = commands.find((c) => c.name === name || c.aliases?.includes(name));
  if (!cmd) return null;

  if (typeof cmd.route === 'function') {
    return cmd.route(args);
  }
  return cmd.route;
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------

export function getCompletions(partial: string): string[] {
  if (!partial.trimStart().startsWith('/')) return [];

  const input = partial.trimStart().slice(1).toLowerCase();
  const hasTrailingSpace = input !== input.trimEnd();
  const parts = input.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return commands.map((c) => `/${c.name}`);
  }

  if (parts.length === 1 && !hasTrailingSpace) {
    const matches = commands.filter((c) => c.name.startsWith(parts[0]));

    // Exact match on a command with subcommands — show subcommands
    const exact = matches.length === 1 ? matches[0] : undefined;
    if (exact?.name === parts[0] && exact.subcommands) {
      return exact.subcommands.map((s) => `/${exact.name} ${s}`);
    }

    return matches.map((c) => `/${c.name}`);
  }

  // Completing subcommand
  const cmd = commands.find((c) => c.name === parts[0]);
  if (cmd?.subcommands) {
    const sub = parts[1] ?? '';
    return cmd.subcommands.filter((s) => s.startsWith(sub)).map((s) => `/${cmd.name} ${s}`);
  }

  return [];
}
