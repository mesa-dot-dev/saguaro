import readline from 'node:readline';
import chalk from 'chalk';

export function createReadline() {
  return readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
}

export type Readline = ReturnType<typeof createReadline>;

export function ask(rl: Readline, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${prompt}: `, (answer: string) => resolve(answer.trim()));
  });
}

export async function askYesNo(rl: Readline, prompt: string): Promise<boolean> {
  const raw = await ask(rl, `${prompt} (y/n)`);
  return raw.toLowerCase() === 'y' || raw.toLowerCase() === 'yes';
}

export async function askChoice<T extends { id: string; label: string }>(
  rl: Readline,
  prompt: string,
  options: readonly T[]
): Promise<T> {
  console.log(chalk.bold(`\n${prompt}`));
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}. ${opt.label}`);
  });
  const raw = await ask(rl, `Choose (1-${options.length})`);
  const idx = parseInt(raw, 10);
  if (Number.isNaN(idx) || idx < 1 || idx > options.length) {
    console.log(chalk.red(`Please enter a number from 1 to ${options.length}.`));
    return askChoice(rl, prompt, options);
  }
  return options[idx - 1] as T;
}
