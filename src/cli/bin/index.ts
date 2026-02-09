#!/usr/bin/env node

import chalk from 'chalk';
import figlet from 'figlet';
import yargs, { type Argv } from 'yargs';
import checkHandler from '../lib/check.js';
import initHandler from '../lib/init.js';
import { createRule, deleteRule, explainRule, listRules, locateRulesDirectory, validateRules } from '../lib/rules.js';
import serveHandler from '../lib/serve.js';
import { reviewCommand } from '../review.js';

interface ReviewArgv {
  base?: string;
  head?: string;
  output?: 'console' | 'json';
  rules?: string;
  verbose?: boolean;
  config?: string;
}

const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');

const showBanner = () => {
  console.log(secondary(figlet.textSync('Mesa', { font: 'Big', horizontalLayout: 'fitted' })));
};

// Wrapper to handle async handlers and errors
const wrapHandler = <T>(handlerName: string, handler: (argv: T) => Promise<number | void> | number | void) => {
  return async (argv: T) => {
    try {
      const exitCode = await handler(argv);
      if (typeof exitCode === 'number') {
        process.exit(exitCode);
      }
    } catch (error) {
      console.error(
        chalk.red(`\n[Mesa CLI] Error in '${handlerName}':`),
        error instanceof Error ? error.message : String(error)
      );
      if (error instanceof Error && error.stack) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  };
};

const argv = process.argv.slice(2);
const isHelp = argv.includes('--help') || argv.includes('-h') || argv.length === 0;

if (isHelp) {
  showBanner();
}

yargs(argv)
  .scriptName(secondary('mesa'))
  .usage(`${secondary('mesa')} <command> ${tertiary('[options]')}`)
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
      return reviewCommand({
        base: argv.base,
        head: argv.head,
        output: argv.output ?? 'console',
        rules: argv.rules,
        verbose: argv.verbose,
        config: argv.config,
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
  .command(
    'rules <command>',
    'Manage and inspect rules',
    (y: Argv) => {
      y.command('list', 'List all defined rules', {}, wrapHandler('rules-list', listRules as (argv: unknown) => void))
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
        );
    },
    () => {} // Default handler if no subcommand
  )
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
  .parse();
