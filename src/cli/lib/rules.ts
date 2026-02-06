import boxen from 'boxen';
import chalk from 'chalk';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import readline from 'readline';
import type { Rule, Severity } from '../../types/types.js';
import { findMesaDir } from './selector.js';

interface RuleTemplate {
  name: string;
  prompts: string[];
  fields: string[];
}

interface RuleTemplates {
  [key: string]: RuleTemplate;
}

const RULE_TEMPLATES: RuleTemplates = {
  ban: {
    name: 'Ban a pattern',
    prompts: ['What pattern to ban?', 'Why is it bad?', 'What to use instead?'],
    fields: ['pattern', 'reason', 'instead'],
  },
  require: {
    name: 'Require a pattern',
    prompts: ['What pattern is required?', 'When is it required?', 'Why is it important?'],
    fields: ['pattern', 'when', 'reason'],
  },
  structure: {
    name: 'File structure',
    prompts: ['What must files contain?', 'Why is it required?'],
    fields: ['must_contain', 'reason'],
  },
  custom: {
    name: 'Custom (full control)',
    prompts: ['Describe the rule'],
    fields: ['instructions'],
  },
};

interface GlobHints {
  [key: string]: string | string[];
}

const GLOB_HINTS: GlobHints = {
  rust: '**/*.rs',
  typescript: '**/*.{ts,tsx}',
  js: '**/*.js',
  python: '**/*.py',
  javascript: '**/*.js',
};

interface GetRulesDirOptions {
  allowMissing?: boolean;
}

const getRulesDir = ({ allowMissing = false }: GetRulesDirOptions = {}): string | undefined => {
  const mesaDir = findMesaDir();
  if (mesaDir) {
    const rulesDir = path.join(mesaDir, 'rules');
    if (fs.existsSync(rulesDir)) return rulesDir;
    if (allowMissing) return rulesDir;
  }
  if (allowMissing) {
    return path.resolve(process.cwd(), '.mesa/rules');
  }
  console.log(chalk.red('No rules directory found. Run "mesa init" first.'));
  return;
};

const loadRules = (rulesDir: string): (Rule & { _filename: string })[] => {
  if (!fs.existsSync(rulesDir)) return [];
  return fs
    .readdirSync(rulesDir)
    .filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f: string): (Rule & { _filename: string }) | null => {
      try {
        const content = fs.readFileSync(path.join(rulesDir, f), 'utf8');
        const rule = yaml.load(content) as Rule | null;
        if (!rule) return null;
        return { ...rule, _filename: f } as Rule & { _filename: string };
      } catch (e) {
        return null;
      }
    })
    .filter((r): r is Rule & { _filename: string } => r !== null);
};

const createReadline = () => readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

const ask = (rl: ReturnType<typeof createReadline>, prompt: string): Promise<string> =>
  new Promise((resolve) => {
    rl.question(`${prompt}: `, (answer: string) => resolve(answer.trim()));
  });

const toKebabCase = (str: string): string =>
  str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const buildUniqueFilename = (rulesDir: string, name: string): string => {
  let candidate = `${name}.yaml`;
  let i = 2;
  while (fs.existsSync(path.join(rulesDir, candidate))) {
    candidate = `${name}-${i}.yaml`;
    i++;
  }
  return candidate;
};

interface ListRulesArgv {
  rules?: string;
}

const listRules = (argv: ListRulesArgv) => {
  const rulesDir = argv.rules || getRulesDir();
  if (!rulesDir || !fs.existsSync(rulesDir)) {
    console.log(chalk.yellow('No rules found.'));
    return;
  }

  const rules = loadRules(rulesDir);
  if (!rules.length) {
    console.log(chalk.gray('No rules found. Use "mesa rules create" to add one.'));
    return;
  }

  console.log(chalk.bold('ID').padEnd(25) + chalk.bold('TITLE').padEnd(40) + chalk.bold('SEVERITY'));
  console.log('─'.repeat(75));
  rules.forEach((r) => {
    const color = r.severity === 'error' ? chalk.red : r.severity === 'warning' ? chalk.yellow : chalk.blue;
    console.log(chalk.cyan(r.id).padEnd(25) + r.title.substring(0, 38).padEnd(40) + color(r.severity));
  });
  console.log(chalk.gray(`\n${rules.length} rules`));
};

interface ExplainRuleArgv {
  rules?: string;
  ruleId: string;
}

const explainRule = (argv: ExplainRuleArgv) => {
  const rulesDir = argv.rules || getRulesDir();
  const rule = loadRules(rulesDir || '').find((r) => r.id === argv.ruleId);
  if (!rule) {
    console.log(chalk.red(`Rule not found: ${argv.ruleId}`));
    return;
  }

  console.log(
    boxen(`${chalk.bold(rule.title)}\n${chalk.gray('ID:')} ${rule.id}\n${chalk.gray('Severity:')} ${rule.severity}`, {
      padding: 1,
      borderStyle: 'round',
      borderColor: 'gray',
    })
  );
  if (rule.globs) {
    console.log(chalk.bold('\nFiles:'));
    rule.globs.forEach((g) => console.log(`  ${g}`));
  }
  if (rule.instructions) {
    console.log(chalk.bold('\nInstructions:'));
    console.log(rule.instructions);
  }
  if (rule.examples) {
    if (rule.examples.violations) {
      console.log(chalk.red('\nViolations:'));
      rule.examples.violations.forEach((v) => console.log(`  ${v}`));
    }
    if (rule.examples.compliant) {
      console.log(chalk.green('\nCompliant:'));
      rule.examples.compliant.forEach((c) => console.log(`  ${c}`));
    }
  }
};

interface DeleteRuleArgv {
  ruleId: string;
}

const deleteRule = (argv: DeleteRuleArgv) => {
  const rulesDir = getRulesDir();
  const ruleFile = loadRules(rulesDir || '').find((r) => r.id === argv.ruleId)?._filename;
  if (!ruleFile) {
    console.log(chalk.red(`Rule not found: ${argv.ruleId}`));
    return;
  }
  fs.unlinkSync(path.join(rulesDir || '', ruleFile));
  console.log(chalk.green(`Deleted: ${argv.ruleId}`));
};

interface ValidateRulesArgv {
  rules?: string;
}

const validateRules = (argv: ValidateRulesArgv) => {
  const rulesDir = argv.rules || getRulesDir();
  if (!rulesDir || !fs.existsSync(rulesDir)) {
    console.log(chalk.red('Rules directory not found.'));
    process.exit(1);
  }

  const files = fs.readdirSync(rulesDir).filter((f: string) => f.endsWith('.yaml') || f.endsWith('.yml'));
  const errors: [string, string[]][] = [];
  const ids = new Set<string>();

  files.forEach((file: string) => {
    const filePath = path.join(rulesDir, file);
    try {
      const rule = yaml.load(fs.readFileSync(filePath, 'utf8')) as Rule;
      const ruleErrors: string[] = [];

      if (!rule.id) ruleErrors.push('missing id');
      else if (!/^[a-z][a-z0-9-]*$/.test(rule.id)) ruleErrors.push('invalid id (kebab-case)');
      else if (ids.has(rule.id)) ruleErrors.push(`duplicate id: ${rule.id}`);
      else ids.add(rule.id);

      if (!rule.title) ruleErrors.push('missing title');
      if (!['error', 'warning', 'info'].includes(rule.severity)) ruleErrors.push('invalid severity');
      if (rule.globs && !Array.isArray(rule.globs)) ruleErrors.push('globs must be an array');
      if (!rule.instructions && (rule as { type?: string }).type === 'custom') ruleErrors.push('missing instructions');

      if (ruleErrors.length) errors.push([file, ruleErrors]);
      else console.log(chalk.green(`[OK] ${file}`));
    } catch (e) {
      errors.push([file, [(e as Error).message]]);
    }
  });

  if (errors.length) {
    console.log('\nErrors:');
    errors.forEach(([file, errs]) => {
      console.log(chalk.red(`  ${file}:`));
      errs.forEach((e) => console.log(chalk.red(`    - ${e}`)));
    });
    process.exit(1);
  }
};

interface CreateRuleArgv {
  rules?: string;
  title?: string;
  id?: string;
  severity?: Severity;
  globs?: string;
  instructions?: string;
}

interface RuleAnswers {
  [key: string]: string;
}

const createRule = async (argv: CreateRuleArgv) => {
  const rulesDir = argv.rules || getRulesDir({ allowMissing: true });
  const isInteractive = process.stdin.isTTY;

  if (!isInteractive) {
    console.log(chalk.red('Interactive terminal required for rule creation.'));
    process.exit(1);
  }

  if (!fs.existsSync(rulesDir || '')) fs.mkdirSync(rulesDir || '', { recursive: true });

  const existingIds = new Set(loadRules(rulesDir || '').map((r) => r.id));
  const rl = createReadline();

  try {
    console.log(chalk.bold('\nWhat kind of rule?'));
    Object.entries(RULE_TEMPLATES).forEach(([key, val], i) => {
      console.log(`  ${i + 1}. ${chalk.bold(val.name)}`);
    });

    const type = (await ask(rl, 'Choose (1-4)')).trim();
    const types = Object.keys(RULE_TEMPLATES);
    if (!['1', '2', '3', '4'].includes(type)) {
      console.log(chalk.red('Choose 1-4'));
      process.exit(1);
    }
    const template = RULE_TEMPLATES[types[parseInt(type) - 1]];

    const answers: RuleAnswers = {};
    for (let i = 0; i < template.prompts.length; i++) {
      const ans = await ask(rl, template.prompts[i]);
      answers[template.fields[i]] = ans;
    }

    const title = await ask(rl, 'Rule title');
    const severity = ((await ask(rl, 'Severity (error/warning/info)')) as Severity) || 'error';
    if (!['error', 'warning', 'info'].includes(severity)) {
      console.log(chalk.red('Severity must be: error, warning, or info'));
      process.exit(1);
    }

    let id = toKebabCase(title);
    if (existingIds.has(id)) id = await ask(rl, `ID "${id}" exists. New ID:`);

    const globHint = await ask(rl, 'Language or glob pattern (e.g., rust, **/*.rs)');
    const globs = GLOB_HINTS[globHint.toLowerCase()] || globHint || '**/*';

    const rule = {
      id,
      type: types[parseInt(type) - 1],
      title,
      severity,
      globs: Array.isArray(globs) ? globs : [globs],
      [types[parseInt(type) - 1]]: answers,
    };

    const filename = buildUniqueFilename(rulesDir || '', id);
    const filePath = path.join(rulesDir || '', filename);
    fs.writeFileSync(filePath, yaml.dump(rule, { lineWidth: 100 }));

    console.log(chalk.green(`\nCreated: ${filePath}`));
  } finally {
    rl.close();
  }
};

export { listRules, explainRule, validateRules, createRule, deleteRule };

export const locateRulesDirectory = () => console.log(chalk.gray(getRulesDir()));
