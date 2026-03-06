import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { findRepoRoot, requireGitRepo } from '../../git/git.js';
import { generateRulesCommand } from '../lib/generate.js';
import { installHook, runHook, runNotify, runPreTool, uninstallHook } from '../lib/hook.js';
import indexCmdHandler from '../lib/index-cmd.js';
import initHandler from '../lib/init.js';
import modelHandler from '../lib/model.js';
import {
  createRule,
  deleteRule,
  explainRule,
  listRules,
  locateRulesDirectory,
  validateRules,
} from '../lib/rules.js';
import serveHandler from '../lib/serve.js';
import { statsCommand } from '../lib/stats.js';
import { MesaError } from '../../util/errors.js';
import { logger } from '../../util/logger.js';
import chalk from 'chalk';
import type { Argv } from 'yargs';
import yargs from 'yargs';
import { daemonStart, daemonStatus, daemonStop } from './commands/daemon.js';
import { reviewCommand } from './commands/review.js';

const secondary = chalk.hex('#be3c00');

const MESA_BANNER = `  __  __
 |  \\/  |
 | \\  / |  ___  ___   __ _
 | |\\/| | / _ \\/ __| / _\` |
 | |  | ||  __/\\__ \\| (_| |
 |_|  |_| \\___||___/ \\__,_|`;

declare const __MESA_VERSION__: string | undefined;

function resolveVersion(): string {
  if (typeof __MESA_VERSION__ === 'string' && __MESA_VERSION__.length > 0) {
    return __MESA_VERSION__;
  }
  try {
    const pkgPath = path.resolve(import.meta.dirname ?? '.', '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

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

const wrapHandler = <T>(handler: (argv: T) => Promise<number | undefined | void> | number | undefined | void) => {
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

const globalAbortController = new AbortController();

interface ReviewArgv {
  base?: string;
  head?: string;
  output?: 'console' | 'json';
  mode?: 'rules' | 'classic' | 'full';
  rules?: string;
  verbose?: boolean;
  debug?: boolean;
  config?: string;
}

/**
 * Parse argv and run a CLI command if one matches.
 * Returns true if a CLI command was handled, false if no command matched (→ launch TUI).
 */
export async function cli(argv: string[]): Promise<boolean> {
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error(chalk.red(`\n[Mesa] Unexpected error: ${message}`));
    process.exitCode = 1;
  });

  process.on('SIGINT', () => {
    globalAbortController.abort();
    console.error(chalk.yellow('\nReview cancelled.'));
    setTimeout(() => process.exit(130), 100);
  });

  // No args → TUI mode
  if (argv.length === 0) {
    return false;
  }

  // "tui" command → TUI mode
  if (argv[0] === 'tui') {
    return false;
  }

  const isHelp = argv.includes('--help') || argv.includes('-h');
  if (isHelp) {
    console.log(secondary(MESA_BANNER));
  }

  // eslint-disable-next-line -- yargs v18 overload resolution requires explicit any
  await (yargs(argv) as any)
    .scriptName(secondary('mesa'))
    .usage(`\n${"No-noise code review that enforces your team's rules and patterns."}`)
    .version(resolveVersion())
    .demandCommand(1, 'Please specify a command')
    .help(true)
    .wrap(90)
    .updateStrings({ 'Commands:': 'CLI Commands:' })

    .command(
      'review',
      'Run an agentic code review on your changes',
      (y: Argv) => {
        y.usage(
          `${secondary('mesa review')} [options]\n\n` +
            'Modes:\n' +
            '  rules    Optimized for bug and codebase violations. Maximum signal, lowest noise.\n' +
            "  classic  Permissive senior-level review, inspired by Mesa's GitHub review product.\n" +
            '  full     Run both rules and classic reviews together.'
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
            describe: 'Show detailed progress',
            type: 'boolean',
            default: false,
          })
          .option('debug', {
            describe: 'Write debug logs to .mesa/.tmp/',
            type: 'boolean',
            default: false,
          })
          .option('c', {
            alias: 'config',
            describe: 'Path to Mesa config file',
            type: 'string',
          })
          .option('rules', {
            describe: 'Path to rules directory',
            type: 'string',
          })
          .option('m', {
            alias: 'mode',
            describe: 'Review mode: rules, classic, or full',
            type: 'string',
            choices: ['rules', 'classic', 'full'] as const,
            default: 'rules',
          });
      },
      wrapHandler(async (argv: ReviewArgv) => {
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
          mode: argv.mode ?? 'rules',
          rules: argv.rules,
          verbose: argv.verbose || argv.debug,
          config: argv.config,
          abortSignal: globalAbortController.signal,
        });
      })
    )

    .command(
      'init',
      'Set up Mesa in your repo (config, rules, hooks, agent integration)',
      (y: Argv) => {
        y.option('force', {
          describe: 'Overwrite existing configuration',
          type: 'boolean',
          default: false,
        });
      },
      wrapHandler(initHandler as (argv: unknown) => Promise<number>)
    )
    .command(
      'model',
      'Switch the AI model used for code reviews',
      (y: Argv) => {
        y.usage(
          `${secondary('mesa model')}\n\nInteractive prompt to switch the AI provider and model used\nfor code reviews. Updates .mesa/config.yaml.`
        );
      },
      wrapHandler(modelHandler as (argv: unknown) => Promise<number>)
    )

    .command('rules <command>', 'Create, list, and manage review rules', (y: Argv) => {
      y.demandCommand(1, 'Please specify a rules subcommand. Run "mesa rules --help" for options.')
        .command(
          'list',
          'List all rules with their IDs, titles, and severity',
          {},
          wrapHandler(listRules as (argv: unknown) => void)
        )
        .command(
          'explain <ruleId>',
          'Show full details for a rule (instructions, globs, examples)',
          (y: Argv) => {
            y.positional('ruleId', {
              describe: 'Rule ID (e.g. n-plus-one-query)',
              type: 'string',
            });
          },
          wrapHandler(explainRule as (argv: unknown) => void)
        )
        .command(
          'validate',
          'Check all rule files for correct structure',
          {},
          wrapHandler(validateRules as (argv: unknown) => number)
        )
        .command(
          'locate',
          'Print the path to the rules directory',
          {},
          wrapHandler(() => locateRulesDirectory()) as (argv: unknown) => Promise<void>
        )
        .command(
          'delete <ruleId>',
          'Delete a rule by its ID',
          (y: Argv) => {
            y.positional('ruleId', {
              describe: 'Rule ID to delete (e.g. n-plus-one-query)',
              type: 'string',
            });
          },
          wrapHandler(deleteRule as (argv: unknown) => void)
        )
        .command(
          'create [target]',
          'Interactively create a new rule with AI assistance',
          (y: Argv) => {
            y.positional('target', {
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
              .option('skip-preview', {
                describe: 'Skip the file-match preview step',
                type: 'boolean',
                default: false,
              });
          },
          wrapHandler(createRule as (argv: unknown) => Promise<number>)
        )
        .command(
          'generate',
          'Auto-generate rules by analyzing your codebase patterns',
          (y: Argv) => {
            y.option('v', {
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
              });
          },
          wrapHandler(((argv: { verbose?: boolean; debug?: boolean; config?: string }) => {
            return generateRulesCommand({
              ...argv,
              abortSignal: globalAbortController.signal,
            });
          }) as (argv: unknown) => Promise<number>)
        );
    })

    .command(
      'serve',
      false as unknown as string,
      () => {},
      wrapHandler(serveHandler as (argv: unknown) => Promise<void>)
    )

    .command(
      'index',
      'Build the import graph for richer review context',
      (y: Argv) => {
        y.option('v', {
          alias: 'verbose',
          describe: 'Show progress as files are parsed',
          type: 'boolean',
          default: false,
        });
      },
      wrapHandler(indexCmdHandler as (argv: unknown) => Promise<void>)
    )

    .command('hook <command>', 'Enable or disable automatic reviews in coding agents', (y: Argv) => {
      y.demandCommand(1, 'Please specify a hook subcommand. Run "mesa hook --help" for options.')
        .command(
          'install',
          'Enable automatic reviews after agents write code',
          {},
          wrapHandler(installHook as (argv: unknown) => Promise<number>)
        )
        .command(
          'uninstall',
          'Disable automatic reviews in coding agents',
          {},
          wrapHandler(uninstallHook as (argv: unknown) => Promise<number>)
        )
        .command(
          'run',
          false as unknown as string,
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
          wrapHandler(runHook as (argv: unknown) => Promise<number>)
        )
        .command(
          'pre-tool',
          false as unknown as string,
          {},
          wrapHandler(runPreTool as (argv: unknown) => Promise<number>)
        )
        .command(
          'notify',
          false as unknown as string,
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
          wrapHandler(runNotify as (argv: unknown) => Promise<number>)
        );
    })

    .command('daemon <command>', false as unknown as string, (y: Argv) => {
      y.demandCommand(1, 'Please specify a daemon command.')
        .command('start', 'Start the daemon', {}, wrapHandler(daemonStart))
        .command('stop', 'Stop the daemon', {}, wrapHandler(daemonStop))
        .command('status', 'Check daemon status', {}, wrapHandler(daemonStatus));
    })

    .command(
      'stats',
      'Show review history and usage analytics',
      (y: Argv) => {
        y.option('days', {
          alias: 'd',
          describe: 'Only include reviews from the last N days',
          type: 'number',
        });
      },
      wrapHandler(((argv: { days?: number }) => {
        return statsCommand({ days: argv.days });
      }) as (argv: unknown) => number)
    )

    .middleware((argv: { _: (string | number)[] }) => {
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

  return true;
}
