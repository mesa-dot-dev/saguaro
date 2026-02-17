import path from 'node:path';
import chalk from 'chalk';
import { buildIndex } from '../../indexer/build.js';
import { JsonIndexStore } from '../../indexer/store.js';
import { findRepoRoot } from '../../lib/skills.js';

interface IndexArgv {
  verbose?: boolean;
}

const indexHandler = async (argv: IndexArgv) => {
  const rootDir = findRepoRoot();
  const mesaCacheDir = path.join(rootDir, '.mesa', 'cache');
  const store = new JsonIndexStore(mesaCacheDir);

  console.log(chalk.gray('Building codebase index...'));
  const startTime = Date.now();

  const index = await buildIndex({
    rootDir,
    store,
    verbose: argv.verbose,
  });

  const fileCount = Object.keys(index.files).length;
  const durationMs = Date.now() - startTime;

  console.log(chalk.green(`Index built: ${fileCount} files in ${durationMs}ms`));
  console.log(chalk.gray(`Saved to .mesa/cache/index.json`));
};

export default indexHandler;
