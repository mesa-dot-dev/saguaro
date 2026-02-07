import { reviewCommand } from '../review.js';

interface ReviewArgv {
  base?: string;
  head?: string;
  output?: string;
  rules?: string;
  verbose?: boolean;
  config?: string;
}

const reviewHandler = async (argv: ReviewArgv) => {
  await reviewCommand({
    base: argv.base,
    head: argv.head,
    output: (argv.output as 'console' | 'json') || 'console',
    rules: argv.rules,
    verbose: argv.verbose,
    config: argv.config,
  });
};

export default reviewHandler;
