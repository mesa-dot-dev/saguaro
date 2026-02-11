#!/usr/bin/env node

import chalk from 'chalk';
import yargs, { type Argv } from 'yargs';
import { MesaError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import checkHandler from '../lib/check.js';
import indexCmdHandler from '../lib/index-cmd.js';
import initHandler from '../lib/init.js';
import {
  createRule,
  deleteRule,
  explainRule,
  generateRulesCommand,
  listRules,
  locateRulesDirectory,
  validateRules,
} from '../lib/rules.js';
import serveHandler from '../lib/serve.js';
import { resolvePackageVersion, reviewCommand } from '../review.js';

// ---------------------------------------------------------------------------
// Global error handlers — catch truly unexpected errors cleanly
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SIGINT handling — abort in-flight work cleanly
// ---------------------------------------------------------------------------

const globalAbortController = new AbortController();

process.on('SIGINT', () => {
  globalAbortController.abort();
  console.error(chalk.yellow('\nReview cancelled.'));
  setTimeout(() => process.exit(130), 100);
});

// ---------------------------------------------------------------------------
// CLI setup
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const isHelp = argv.includes('--help') || argv.includes('-h') || argv.length === 0;

if (isHelp) {
  showBanner();
}

yargs(argv)
  .scriptName(secondary('mesa'))
  .usage(`${secondary('mesa')} <command> ${tertiary('[options]')}`)
  .version(resolvePackageVersion())
  .demandCommand(1, 'Please specify a command')
  .help(true)
  .wrap(80)
  .command(
    'review',
    'Run an AI-assisted code review',
    (y: Argv) => {
      y.option('b', {
        alias: 'base',
        describe: 'Base branch to diff against',
        type: 'string',
        default: 'main',
      })
        .option('head', {
          describe: 'Head ref to diff against',
          type: 'string',
          default: 'HEAD',
        })
        .option('o', {
          alias: 'output',
          describe: 'Output format: console, json',
          type: 'string',
          choices: ['console', 'json'] as const,
          default: 'console',
        })
        .option('v', {
          alias: 'verbose',
          describe: 'Show detailed progress',
          type: 'boolean',
          default: false,
        })
        .option('debug', {
          describe: 'Show debug output (prompts, raw LLM responses)',
          type: 'boolean',
          default: false,
        })
        .option('c', {
          alias: 'config',
          describe: 'Path to config file',
          type: 'string',
          default: '.mesa/config.yaml',
        })
        .option('rules', {
          describe: 'Path to rules directory',
          type: 'string',
        });
    },
    wrapHandler('review', (async (argv: ReviewArgv) => {
      // Set logger level based on flags
      if (argv.debug) {
        logger.setLevel('debug');
      } else if (argv.verbose) {
        logger.setLevel('verbose');
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
  .command(
    'init',
    'Initialize Mesa in a repository',
    (y: Argv) => {
      y.option('force', {
        describe: 'Overwrite existing configuration',
        type: 'boolean',
        default: false,
      });
    },
    wrapHandler('init', initHandler as (argv: unknown) => Promise<number>)
  )
  .command('rules <command>', 'Manage and inspect rules', (y: Argv) => {
    y.demandCommand(1, 'Please specify a rules subcommand. Run "mesa rules --help" for options.')
      .command('list', 'List all defined rules', {}, wrapHandler('rules-list', listRules as (argv: unknown) => void))
      .command(
        'explain <ruleId>',
        'Show detailed information about a rule',
        (y: Argv) => {
          y.positional('ruleId', {
            describe: 'Rule ID',
            type: 'string',
          });
        },
        wrapHandler('rules-explain', explainRule as (argv: unknown) => void)
      )
      .command(
        'validate',
        'Validate rule files',
        {},
        wrapHandler('rules-validate', validateRules as (argv: unknown) => number)
      )
      .command(
        'locate',
        'Locate the rules directory',
        {},
        wrapHandler('rules-locate', () => locateRulesDirectory()) as (argv: unknown) => Promise<void>
      )
      .command(
        'delete <ruleId>',
        'Delete a rule',
        (y: Argv) => {
          y.positional('ruleId', {
            describe: 'Rule ID',
            type: 'string',
          });
        },
        wrapHandler('rules-delete', deleteRule as (argv: unknown) => void)
      )
      .command(
        'create [title]',
        'Create a new rule file',
        (y: Argv) => {
          y.positional('title', {
            describe: 'Rule title',
            type: 'string',
          })
            .option('id', { describe: 'Rule ID (kebab-case)' })
            .option('severity', { describe: 'Rule severity', default: 'error' })
            .option('globs', { describe: 'Comma-separated glob patterns' })
            .option('instructions', { describe: 'Rule instructions' });
        },
        wrapHandler('rules-create', createRule as (argv: unknown) => Promise<number>)
      )
      .command(
        'generate',
        'Analyze your project and generate review rules with AI',
        (y: Argv) => {
          y.option('force', {
            describe: 'Overwrite existing rules with the same ID',
            type: 'boolean',
            default: false,
          })
            .option('count', {
              describe: 'Number of rules to generate',
              type: 'number',
              default: 8,
            })
            .option('c', {
              alias: 'config',
              describe: 'Path to config file',
              type: 'string',
              default: '.mesa/config.yaml',
            });
        },
        wrapHandler('rules-generate', generateRulesCommand as (argv: unknown) => Promise<number>)
      );
  })
  .command(
    'check <rule-id> [file]',
    'Check a specific rule against a file or code snippet',
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
    'Run Mesa as an MCP server for Claude/Cursor integration',
    () => {},
    wrapHandler('serve', serveHandler as (argv: unknown) => Promise<number>)
  )
  .command(
    'index',
    'Build or rebuild the codebase index',
    (y: Argv) => {
      y.option('v', {
        alias: 'verbose',
        describe: 'Show detailed progress',
        type: 'boolean',
        default: false,
      });
    },
    wrapHandler('index', indexCmdHandler as (argv: unknown) => Promise<void>)
  )
  .parse();
