import chalk from 'chalk';

// interface CheckArgv {
//   ruleId: string;
//   file?: string;
// }

const checkHandler = async (): Promise<number> => {
  console.log(chalk.red('Check command not implemented'));
  return 1;
};

export default checkHandler;
