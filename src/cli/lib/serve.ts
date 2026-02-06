import chalk from 'chalk';

interface ServeArgv {
  [key: string]: unknown;
}

const serveHandler = async (argv: ServeArgv) => {
  console.log(chalk.red('Serve command not implemented'));
  process.exit(1);
};

export default serveHandler;
