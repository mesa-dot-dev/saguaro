import chalk from 'chalk';

interface CheckArgv {
  ruleId: string;
  file?: string;
}

const checkHandler = async (argv: CheckArgv) => {
  console.log(chalk.red('Check command not implemented'));
  process.exit(1);
};

export default checkHandler;
