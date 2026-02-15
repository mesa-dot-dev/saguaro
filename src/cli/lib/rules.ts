import boxen from 'boxen';
import chalk from 'chalk';
import {
  createSkillAdapter,
  deleteSkillAdapter,
  explainSkillAdapter,
  listSkillsAdapter,
  locateSkillsDirectoryAdapter,
  validateSkillsAdapter,
} from '../../adapter/skills.js';
import type { Severity } from '../../types/types.js';
import { ask, createReadline } from './prompt.js';

interface RuleTemplate {
  name: string;
  prompts: string[];
  fields: string[];
}

const RULE_TEMPLATES: Record<string, RuleTemplate> = {
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

const GLOB_HINTS: Record<string, string | string[]> = {
  rust: '**/*.rs',
  typescript: '**/*.{ts,tsx}',
  js: '**/*.js',
  python: '**/*.py',
  javascript: '**/*.js',
};

interface RuleAnswers {
  [key: string]: string;
}

interface ListRulesArgv {
  rules?: string;
}

interface ExplainRuleArgv {
  rules?: string;
  ruleId: string;
}

interface DeleteRuleArgv {
  ruleId: string;
  rules?: string;
}

interface ValidateRulesArgv {
  rules?: string;
}

interface CreateRuleArgv {
  rules?: string;
}

const listRules = (argv: ListRulesArgv) => {
  const result = listSkillsAdapter({ skillsDir: argv.rules });
  const rules = result.skills;
  if (!rules.length) {
    console.log(chalk.gray('No rules found. Use "mesa rules create" to add one.'));
    return;
  }

  console.log(chalk.bold('ID').padEnd(25) + chalk.bold('TITLE').padEnd(40) + chalk.bold('SEVERITY'));
  console.log('─'.repeat(75));
  rules.forEach((rule) => {
    const color = rule.severity === 'error' ? chalk.red : rule.severity === 'warning' ? chalk.yellow : chalk.blue;
    console.log(chalk.cyan(rule.id).padEnd(25) + rule.title.substring(0, 38).padEnd(40) + color(rule.severity));
  });
  console.log(chalk.gray(`\n${rules.length} rules`));
};

const explainRule = (argv: ExplainRuleArgv) => {
  const result = explainSkillAdapter({ skillsDir: argv.rules, skillId: argv.ruleId });
  const rule = result.skill;
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
    rule.globs.forEach((glob) => console.log(`  ${glob}`));
  }
  if (rule.instructions) {
    console.log(chalk.bold('\nInstructions:'));
    console.log(rule.instructions);
  }
  if (rule.examples?.violations) {
    console.log(chalk.red('\nViolations:'));
    rule.examples.violations.forEach((value) => console.log(`  ${value}`));
  }
  if (rule.examples?.compliant) {
    console.log(chalk.green('\nCompliant:'));
    rule.examples.compliant.forEach((value) => console.log(`  ${value}`));
  }
};

const deleteRule = (argv: DeleteRuleArgv) => {
  const result = deleteSkillAdapter({ skillsDir: argv.rules, skillId: argv.ruleId });
  if (!result.deleted) {
    console.log(chalk.red(`Rule not found: ${argv.ruleId}`));
    return;
  }
  console.log(chalk.green(`Deleted: ${argv.ruleId}`));
};

const validateRules = (argv: ValidateRulesArgv): number => {
  const result = validateSkillsAdapter({ skillsDir: argv.rules });
  result.validated.forEach((file) => console.log(chalk.green(`[OK] ${file}`)));

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    result.errors.forEach((entry) => {
      console.log(chalk.red(`  ${entry.file}:`));
      entry.errors.forEach((error) => console.log(chalk.red(`    - ${error}`)));
    });
    return 1;
  }

  return 0;
};

const createRule = async (argv: CreateRuleArgv): Promise<number> => {
  if (!process.stdin.isTTY) {
    console.log(chalk.red('Interactive terminal required for rule creation.'));
    return 1;
  }

  const rl = createReadline();
  try {
    console.log(chalk.bold('\nWhat kind of rule?'));
    const templateKeys = Object.keys(RULE_TEMPLATES);
    templateKeys.forEach((key, index) => {
      console.log(`  ${index + 1}. ${chalk.bold(RULE_TEMPLATES[key].name)}`);
    });

    const typeRaw = (await ask(rl, 'Choose (1-4)')).trim();
    if (!['1', '2', '3', '4'].includes(typeRaw)) {
      console.log(chalk.red('Choose 1-4'));
      return 1;
    }

    const template = RULE_TEMPLATES[templateKeys[parseInt(typeRaw, 10) - 1]];
    const answers: RuleAnswers = {};
    for (let i = 0; i < template.prompts.length; i += 1) {
      answers[template.fields[i]] = await ask(rl, template.prompts[i]);
    }

    const title = await ask(rl, 'Rule title');
    const severityRaw = ((await ask(rl, 'Severity (error/warning/info)')) || 'error') as Severity;
    if (!['error', 'warning', 'info'].includes(severityRaw)) {
      console.log(chalk.red('Severity must be: error, warning, or info'));
      return 1;
    }

    const globHint = await ask(rl, 'Language or glob pattern (e.g., rust, **/*.rs)');
    const globs = GLOB_HINTS[globHint.toLowerCase()] || globHint || '**/*';
    const instructions = buildInstructions(templateKeys[parseInt(typeRaw, 10) - 1], answers);
    const triggerConditions = await ask(rl, 'Trigger cues (what changes should activate this rule?)');
    const exclusions = await ask(rl, 'Exclusions (what should this rule ignore?)');
    const description = buildRuleDescription(
      title,
      Array.isArray(globs) ? globs : [globs],
      triggerConditions,
      exclusions
    );

    const created = createSkillAdapter({
      skillsDir: argv.rules,
      title,
      description,
      severity: severityRaw,
      globs: Array.isArray(globs) ? globs : [globs],
      instructions,
    });

    console.log(chalk.green(`\nCreated: ${created.policyFilePath}`));
    return 0;
  } finally {
    rl.close();
  }
};

const locateRulesDirectory = (): number => {
  const result = locateSkillsDirectoryAdapter();
  const rulesDir = result.skillsDir;
  if (!rulesDir) {
    console.log(chalk.red('No rules directory found. Run "mesa init" first.'));
    return 1;
  }

  console.log(chalk.gray(rulesDir));
  return 0;
};

function buildInstructions(templateType: string, answers: RuleAnswers): string {
  switch (templateType) {
    case 'ban':
      return [`Do not use: ${answers.pattern}`, `Reason: ${answers.reason}`, `Use instead: ${answers.instead}`].join(
        '\n'
      );
    case 'require':
      return [`Required pattern: ${answers.pattern}`, `When: ${answers.when}`, `Reason: ${answers.reason}`].join('\n');
    case 'structure':
      return [`Files must contain: ${answers.must_contain}`, `Reason: ${answers.reason}`].join('\n');
    case 'custom':
      return answers.instructions;
    default:
      return Object.entries(answers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
  }
}

function buildRuleDescription(title: string, globs: string[], triggerConditions: string, exclusions: string): string {
  const scope = globs.join(', ');
  const trigger = triggerConditions.trim().length > 0 ? triggerConditions.trim() : `changes match ${scope}`;
  const exclusion = exclusions.trim().length > 0 ? exclusions.trim() : 'cases outside the rule scope';

  return `${title}. Enforces this rule in ${scope}. Use when ${trigger}. Do not use for ${exclusion}.`;
}

export { createRule, deleteRule, explainRule, listRules, locateRulesDirectory, validateRules };
