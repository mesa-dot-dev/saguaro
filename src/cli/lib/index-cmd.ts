import path from 'node:path';
import chalk from 'chalk';
import { findRepoRoot } from '../../git/git.js';
import { buildIndex } from '../../indexer/build.js';
import { JsonIndexStore } from '../../indexer/store.js';

interface IndexArgv {
  verbose?: boolean;
}

const indexHandler = async (argv: IndexArgv) => {
  const rootDir = findRepoRoot();
  const saguaroCacheDir = path.join(rootDir, '.saguaro', 'cache');
  const store = new JsonIndexStore(saguaroCacheDir);

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
  console.log(chalk.gray(`Saved to .saguaro/cache/index.json`));
};

export default indexHandler;
