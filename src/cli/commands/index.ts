import fs from 'node:fs';
import path from 'node:path';
import { inspect } from 'node:util';
import { findRepoRoot, logger, MesaError, requireGitRepo } from '@mesa/code-review';
import chalk from 'chalk';
import type { Argv } from 'yargs';
import yargs from 'yargs';
import { daemonStart, daemonStatus, daemonStop } from './commands/daemon.js';
import { reviewCommand } from './commands/review.js';

const secondary = chalk.hex('#be3c00');
const tertiary = chalk.hex('#ffecba');

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
      'Review code changes against your rules',
      (y: Argv) => {
        y.option('b', {
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
          rules: argv.rules,
          verbose: argv.verbose || argv.debug,
          config: argv.config,
          abortSignal: globalAbortController.signal,
        });
      })
    )

    .command('daemon <command>', false as unknown as string, (y: Argv) => {
      y.demandCommand(1, 'Please specify a daemon command.')
        .command('start', 'Start the daemon', {}, wrapHandler(daemonStart))
        .command('stop', 'Stop the daemon', {}, wrapHandler(daemonStop))
        .command('status', 'Check daemon status', {}, wrapHandler(daemonStatus));
    })

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
