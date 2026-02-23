#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import chalk from 'chalk';
import yargs, { type Argv } from 'yargs';
import { MesaError } from '../../lib/errors.js';
import { requireGitRepo } from '../../lib/git.js';
import { logger } from '../../lib/logger.js';
import { findRepoRoot } from '../../lib/rule-resolution.js';
import checkHandler from '../lib/check.js';
import { generateRulesCommand } from '../lib/generate.js';
import { installHook, runHook, runPreTool, uninstallHook } from '../lib/hook.js';
import indexCmdHandler from '../lib/index-cmd.js';
import initHandler from '../lib/init.js';
import { createRule, deleteRule, explainRule, listRules, locateRulesDirectory, validateRules } from '../lib/rules.js';
import serveHandler from '../lib/serve.js';
import { statsCommand } from '../lib/stats.js';
import { resolvePackageVersion, reviewCommand } from '../review.js';

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  console.error(chalk.red(`\n[Mesa] Unexpected error: ${message}`));
  console.error(chalk.gray('This is a bug. Please report it at https://github.com/anthropics/mesa/issues'));
  process.exitCode = 1;
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red(`\n[Mesa] Unexpected error: ${error.message}`));
  console.error(chalk.gray('This is a bug. Please report it at https://github.com/anthropics/mesa/issues'));
  process.exit(1);
});

interface ReviewArgv {
  base?: string;
  head?: string;
  output?: 'console' | 'json';
  rules?: string;
  verbose?: boolean;
  debug?: boolean;
  config?: string;
}

const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');

const MESA_BANNER = `  __  __
 |  \\/  |
 | \\  / |  ___  ___   __ _
 | |\\/| | / _ \\/ __| / _\` |
 | |  | ||  __/\\__ \\| (_| |
 |_|  |_| \\___||___/ \\__,_|`;

const showBanner = () => {
  console.log(secondary(MESA_BANNER));
};

function printError(error: unknown): void {
  if (error instanceof MesaError) {
    console.error(chalk.red(`\n[Mesa] ${error.message}`));
    if (error.suggestion) {
      console.error(chalk.yellow(`  ${error.suggestion}`));
    }
    if (error.stack) {
      const level = logger.getLevel();
      if (level === 'verbose' || level === 'debug') {
        console.error(chalk.gray(error.stack));
      }
    }
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(chalk.red(`\n[Mesa] ${message}`));

  if (error instanceof Error && error.stack) {
    const level = logger.getLevel();
    if (level === 'verbose' || level === 'debug') {
      console.error(chalk.gray(error.stack));
    }
  }
}

// Wrapper to handle async handlers and errors
const wrapHandler = <T>(
  _handlerName: string,
  // biome-ignore lint/suspicious/noConfusingVoidType: needed for handlers that return void
  handler: (argv: T) => Promise<number | undefined | void> | number | undefined | void
) => {
  return async (argv: T) => {
    try {
      const exitCode = await handler(argv);
      if (typeof exitCode === 'number') {
        process.exit(exitCode);
      }
    } catch (error) {
      printError(error);
      const exitCode = error instanceof MesaError ? error.exitCode : 1;
      process.exit(exitCode);
    }
  };
};

const globalAbortController = new AbortController();

function enableDebugCapture(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  fs.appendFileSync(resolvedPath, `\n=== Mesa Debug Session ${new Date().toISOString()} ===\n`, 'utf8');

  const format = (args: unknown[]) =>
    args
      .map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { colors: false, depth: 6, breakLength: 120 })))
      .join(' ');

  const write = (level: 'LOG' | 'INFO' | 'WARN' | 'ERROR', args: unknown[]) => {
    const line = `${new Date().toISOString()} [${level}] ${format(args)}\n`;
    try {
      fs.appendFileSync(resolvedPath, line, 'utf8');
    } catch {
      // Ignore logging sink failures.
    }
  };

  const fileOnly = (...args: unknown[]) => write('LOG', args);
  console.log = fileOnly;
  console.info = fileOnly;
  console.warn = fileOnly;
  console.error = fileOnly;

  return resolvedPath;
}

process.on('SIGINT', () => {
  globalAbortController.abort();
  console.error(chalk.yellow('\nReview cancelled.'));
  setTimeout(() => process.exit(130), 100);
});

const argv = process.argv.slice(2);
const isHelp = argv.includes('--help') || argv.includes('-h') || argv.length === 0;

if (isHelp) {
  showBanner();
}

yargs(argv)
  .scriptName(secondary('mesa'))
  .usage(
    '\n' +
      "No-noise code review that enforces your team's rules and patterns.\n\n" +
      `${secondary('Use with Claude Code:')}\n` +
      '  mesa init sets up MCP integration and a review hook automatically.\n' +
      '  Available slash commands inside Claude Code:\n\n' +
      `    ${secondary('/mesa-review')}          Run a code review. Optionally specify a branch / head ref.\n` +
      `    ${secondary('/mesa-createrule')}      Create a new review rule\n` +
      `    ${secondary('/mesa-generaterules')}   Auto-generate rules from your codebase\n\n` +
      '  Mesa also adds a configurable hook that automatically reviews code\n' +
      '  after each iteration Claude Code makes to your codebase. If violations\n' +
      '  are found, Claude is blocked and asked to fix them before completing.'
  )
  .version(resolvePackageVersion())
  .demandCommand(1, 'Please specify a command')
  .help(true)
  .wrap(90)
  .updateStrings({ 'Commands:': 'CLI Commands:' })
  .epilog(
    `${secondary('Getting started:')}\n` +
      `  $ mesa init                   Set up Mesa and enable automatic reviews\n` +
      `  $ mesa rules generate         Auto-generate rules from your codebase\n` +
      `  $ mesa review                 Run a review manually\n\n` +
      `${secondary('Rules:')}\n` +
      `  Rules live in .mesa/rules/ as version-controlled markdown files. Each\n` +
      `  rule defines what to check, which files it applies to, and its severity.\n` +
      `  Globs use repo-root-relative paths for monorepo support.`
  )
  .command(
    'init',
    'Set up Mesa in your repo (config, rules, hooks, Claude Code integration)',
    (y: Argv) => {
      y.usage(
        `${secondary('mesa init')} ${tertiary('[options]')}\n\n` +
          'Creates .mesa/config.yaml, .mesa/rules/ for rules, .mcp.json for\n' +
          'Claude Code MCP integration, and installs a Claude Code review hook.\n' +
          'Optionally generates starter rules to get going immediately.'
      )
        .option('force', {
          describe: 'Overwrite existing configuration',
          type: 'boolean',
          default: false,
        })
        .example('$0 init', 'Interactive setup with API key and starter rules')
        .example('$0 init --force', 'Re-initialize, overwriting existing config');
    },
    wrapHandler('init', initHandler as (argv: unknown) => Promise<number>)
  )

  .command(
    'review',
    'Review code changes against your rules',
    (y: Argv) => {
      y.usage(
        `${secondary('mesa review')} ${tertiary('[options]')}\n\nDiff two git refs and check changed files against matching rules.\nExits 0 when clean, 1 when violations are found.`
      )
        .option('b', {
          alias: 'base',
          describe: 'Base branch to diff against',
          type: 'string',
          defaultDescription: 'main',
        })
        .option('head', {
          describe: 'Head ref to review',
          type: 'string',
          defaultDescription: 'HEAD',
        })
        .option('o', {
          alias: 'output',
          describe: 'Output format',
          type: 'string',
          choices: ['console', 'json'] as const,
          default: 'console',
        })
        .option('v', {
          alias: 'verbose',
          describe: 'Show detailed progress and file-level status',
          type: 'boolean',
          default: false,
        })
        .option('debug', {
          describe: 'Write debug logs (prompts, LLM responses) to .mesa/.tmp/',
          type: 'boolean',
          default: false,
        })
        .option('c', {
          alias: 'config',
          describe: 'Path to Mesa config file',
          type: 'string',
          defaultDescription: '.mesa/config.yaml',
        })
        .option('rules', {
          describe: 'Path to rules directory',
          type: 'string',
          defaultDescription: '.mesa/rules/',
        })
        .example('$0 review', 'Review current branch against main')
        .example('$0 review -b develop', 'Review against a different base branch')
        .example('$0 review -o json', 'Output as JSON for CI pipelines')
        .example('$0 review --head origin/feat', 'Compare two remote refs');
    },
    wrapHandler('review', (async (argv: ReviewArgv) => {
      // Set logger level based on flags
      if (argv.debug) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const debugLogPath = enableDebugCapture(
          path.resolve(findRepoRoot(), '.mesa', '.tmp', `logfile-${timestamp}.txt`)
        );
        logger.setLevel('debug');
        logger.info(chalk.gray(`[debug] Writing debug logs to ${debugLogPath}`));
      } else if (argv.verbose) {
        logger.setLevel('verbose');
      } else {
        logger.setLevel('normal');
      }

      return reviewCommand({
        base: argv.base,
        head: argv.head,
        output: argv.output ?? 'console',
        rules: argv.rules,
        verbose: argv.verbose || argv.debug,
        config: argv.config,
        abortSignal: globalAbortController.signal,
      });
    }) as (argv: unknown) => Promise<number>)
  )

  .command('rules <command>', 'Create, list, and manage review rules', (y: Argv) => {
    y.usage(
      `${secondary('mesa rules')} <command>\n\n` +
        'Rules define what Mesa checks during a review. Each rule has a title,\n' +
        'severity (error/warning/info), file patterns (globs), and instructions\n' +
        'for the reviewer. Rules are stored in .mesa/rules/ as version-\n' +
        'controlled markdown files with repo-root-relative globs.'
    )
      .demandCommand(1, 'Please specify a rules subcommand. Run "mesa rules --help" for options.')
      .command(
        'list',
        'List all rules with their IDs, titles, and severity',
        {},
        wrapHandler('rules-list', listRules as (argv: unknown) => void)
      )
      .command(
        'explain <ruleId>',
        'Show full details for a rule (instructions, globs, examples)',
        (y: Argv) => {
          y.positional('ruleId', {
            describe: 'Rule ID (e.g. no-console-log)',
            type: 'string',
          });
        },
        wrapHandler('rules-explain', explainRule as (argv: unknown) => void)
      )
      .command(
        'validate',
        'Check all rule files for correct structure',
        {},
        wrapHandler('rules-validate', validateRules as (argv: unknown) => number)
      )
      .command(
        'locate',
        'Print the path to the rules directory',
        {},
        wrapHandler('rules-locate', () => locateRulesDirectory()) as (argv: unknown) => Promise<void>
      )
      .command(
        'delete <ruleId>',
        'Delete a rule by its ID',
        (y: Argv) => {
          y.positional('ruleId', {
            describe: 'Rule ID to delete (e.g. no-console-log)',
            type: 'string',
          });
        },
        wrapHandler('rules-delete', deleteRule as (argv: unknown) => void)
      )
      .command(
        'create [target]',
        'Interactively create a new rule with AI assistance',
        (y: Argv) => {
          y.usage(
            `${secondary('mesa rules create')} ${tertiary('[target] [options]')}\n\n` +
              'Walk through an interactive flow to define a new review rule.\n' +
              'Mesa analyzes the target directory, generates rule instructions\n' +
              'with AI, previews which files would match, and saves the rule\n' +
              'to .mesa/rules/.'
          )
            .positional('target', {
              describe: 'Directory the rule targets (e.g. src/api, packages/web)',
              type: 'string',
            })
            .option('intent', {
              describe: 'What the rule should enforce (e.g. "no direct DB queries in handlers")',
              type: 'string',
            })
            .option('severity', {
              describe: 'Rule severity: error, warning, or info',
              type: 'string',
            })
            .option('title', {
              describe: 'Rule title (auto-generated from intent if omitted)',
              type: 'string',
            })
            .option('debug', { describe: 'Write debug log', type: 'boolean', default: false })
            .option('skip-preview', { describe: 'Skip the file-match preview step', type: 'boolean', default: false })
            .example('$0 rules create src/api', 'Create a rule scoped to src/api')
            .example('$0 rules create --intent "no console.log"', 'Create a rule from a description');
        },
        wrapHandler('rules-create', createRule as (argv: unknown) => Promise<number>)
      )
      .command(
        'generate',
        'Auto-generate rules by analyzing your codebase patterns',
        (y: Argv) => {
          y.usage(
            `${secondary('mesa rules generate')} ${tertiary('[options]')}\n\n` +
              'Scans your codebase, detects conventions and patterns, and\n' +
              'proposes review rules. You review each proposed rule interactively\n' +
              'and choose which ones to keep.'
          )
            .option('v', {
              alias: 'verbose',
              describe: 'Show detailed analysis progress',
              type: 'boolean',
              default: false,
            })
            .option('debug', {
              describe: 'Show debug output (prompts, LLM responses)',
              type: 'boolean',
              default: false,
            })
            .option('c', {
              alias: 'config',
              describe: 'Path to Mesa config file',
              type: 'string',
            })
            .example('$0 rules generate', 'Scan codebase and propose rules')
            .example('$0 rules generate -v', 'Generate with detailed progress');
        },
        wrapHandler('rules-generate', ((argv: { verbose?: boolean; debug?: boolean; config?: string }) => {
          return generateRulesCommand({
            ...argv,
            abortSignal: globalAbortController.signal,
          });
        }) as (argv: unknown) => Promise<number>)
      );
  })
  .command(
    'check <rule-id> [file]',
    false, // hidden — not yet implemented
    (y: Argv) => {
      y.positional('rule-id', {
        describe: 'Rule ID to check',
        type: 'string',
      }).positional('file', {
        describe: 'File to check',
        type: 'string',
      });
    },
    wrapHandler('check', checkHandler as (argv: unknown) => Promise<number>)
  )
  .command(
    'serve',
    false, // hidden — started automatically by Claude Code
    () => {},
    wrapHandler('serve', serveHandler as (argv: unknown) => Promise<void>)
  )
  .command(
    'index',
    'Build the import graph for richer review context',
    (y: Argv) => {
      y.usage(
        `${secondary('mesa index')} ${tertiary('[options]')}\n\n` +
          'Builds an import graph of your codebase so reviews understand how\n' +
          'changes propagate across files. Saved to .mesa/cache/index.json.\n' +
          'Rebuilt incrementally on subsequent runs. Reviews work without an\n' +
          'index but produce better results with one.'
      )
        .option('v', {
          alias: 'verbose',
          describe: 'Show progress as files are parsed',
          type: 'boolean',
          default: false,
        })
        .example('$0 index', 'Build or update the codebase index')
        .example('$0 index -v', 'Build with detailed progress');
    },
    wrapHandler('index', indexCmdHandler as (argv: unknown) => Promise<void>)
  )
  .command('hook <command>', 'Enable or disable automatic reviews in Claude Code', (y: Argv) => {
    y.usage(
      `${secondary('mesa hook')} <command>\n\n` +
        'When Claude Code finishes writing code, Mesa can automatically review\n' +
        'the uncommitted changes against your rules. If violations are found,\n' +
        'Claude is blocked and asked to fix them before completing.\n\n' +
        'This is installed automatically by mesa init. Use these commands to\n' +
        'enable or disable automatic reviews after setup.'
    )
      .demandCommand(1, 'Please specify a hook subcommand. Run "mesa hook --help" for options.')
      .command(
        'install',
        'Enable automatic reviews after Claude Code writes code',
        (y: Argv) => {
          y.usage(
            `${secondary('mesa hook install')}\n\n` +
              'Enables automatic code review in Claude Code. After Claude Code\n' +
              'finishes writing code, Mesa reviews all uncommitted changes against\n' +
              'your rules. If violations are found, Claude is blocked and asked to\n' +
              'fix them before completing.\n\n' +
              'This is installed automatically by mesa init.'
          );
        },
        wrapHandler('hook-install', installHook as (argv: unknown) => Promise<number>)
      )
      .command(
        'uninstall',
        'Disable automatic reviews in Claude Code',
        (y: Argv) => {
          y.usage(
            `${secondary('mesa hook uninstall')}\n\n` +
              'Disables automatic code review. Claude Code will no longer review\n' +
              'changes after writing code. You can still run mesa review manually.'
          );
        },
        wrapHandler('hook-uninstall', uninstallHook as (argv: unknown) => Promise<number>)
      )
      .command(
        'run',
        false, // hidden — internal command called by the hook itself
        (y: Argv) => {
          y.option('c', {
            alias: 'config',
            describe: 'Path to config file',
            type: 'string',
          }).option('v', {
            alias: 'verbose',
            describe: 'Show detailed progress',
            type: 'boolean',
            default: false,
          });
        },
        wrapHandler('hook-run', runHook as (argv: unknown) => Promise<number>)
      )
      .command(
        'pre-tool',
        false, // hidden — internal command called by PreToolUse hook
        {},
        wrapHandler('hook-pre-tool', runPreTool as (argv: unknown) => number)
      );
  })
  .command(
    'stats',
    'Show review history and usage analytics',
    (y: Argv) => {
      y.usage(
        `${secondary('mesa stats')} ${tertiary('[options]')}\n\n` +
          'Displays aggregated analytics from your local review history.\n' +
          'Includes cost, token usage, model breakdown, violation trends,\n' +
          'and rule effectiveness. Data comes from .mesa/history/reviews.jsonl\n' +
          '(never sent anywhere).'
      )
        .option('days', {
          alias: 'd',
          describe: 'Only include reviews from the last N days',
          type: 'number',
        })
        .example('$0 stats', 'Show all-time review analytics')
        .example('$0 stats -d 7', 'Show last 7 days')
        .example('$0 stats -d 30', 'Show last 30 days');
    },
    wrapHandler('stats', ((argv: { days?: number }) => {
      return statsCommand({ days: argv.days });
    }) as (argv: unknown) => number)
  )
  .middleware((argv) => {
    const command = argv._[0];
    if (!command || command === 'init') return;
    try {
      requireGitRepo();
    } catch (error) {
      printError(error);
      process.exit(1);
    }
  })
  .parse();
