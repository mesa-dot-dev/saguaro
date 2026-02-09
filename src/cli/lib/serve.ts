import chalk from 'chalk';

// interface ServeArgv {
//   [key: string]: unknown;
// }

const serveHandler = async (): Promise<number> => {
  console.log(chalk.red('Serve command not implemented'));
  return 1;
};

export default serveHandler;
