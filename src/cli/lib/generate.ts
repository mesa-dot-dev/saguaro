import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { writeGeneratedRules } from '../../adapter/rules.js';
import type { GeneratorProgressEvent } from '../../generator/index.js';
import { generateRules } from '../../generator/index.js';
import { logger } from '../../lib/logger.js';
import { loadValidatedConfig } from '../../lib/review-model-config.js';
import { estimateCost } from '../../lib/review-runner.js';
import type { RulePolicy } from '../../types/types.js';
import { createReadline } from './prompt.js';
import { CliSpinner } from './spinner.js';

interface GenerateRulesArgv {
  verbose?: boolean;
  debug?: boolean;
  config?: string;
  abortSignal?: AbortSignal;
}

export async function generateRulesCommand(argv: GenerateRulesArgv): Promise<number> {
  if (argv.debug) {
    logger.setLevel('debug');
  } else if (argv.verbose) {
    logger.setLevel('verbose');
  }

  const spinner = new CliSpinner();
  spinner.start('Scanning codebase...');

  let totalZones = 0;
  let zonesCompleted = 0;
  let totalFiles = 0;

  const onProgress = (event: GeneratorProgressEvent): void => {
    switch (event.type) {
      case 'indexing':
        spinner.update('Indexing codebase...');
        break;
      case 'scan_complete':
        totalZones = event.zoneCount;
        totalFiles = event.totalFiles;
        spinner.update(`Found ${event.totalFiles} source files`);
        logger.verbose(chalk.gray(`  Extensions: ${formatExtensions(event.extensions)}`));
        break;
      case 'zone_started':
        if (zonesCompleted === 0) {
          spinner.start(`Analyzing ${totalFiles} files for patterns...`);
        }
        break;
      case 'zone_completed':
        zonesCompleted++;
        logger.verbose(
          chalk.gray(
            `  ${event.zoneName} — ${event.rulesProposed} candidates (${(event.durationMs / 1000).toFixed(1)}s)`
          )
        );
        if (zonesCompleted < totalZones) {
          const pct = Math.round((zonesCompleted / totalZones) * 100);
          spinner.update(`Analyzing ${totalFiles} files for patterns... ${pct}%`);
        }
        break;
      case 'synthesis_started':
        spinner.start(`Refining ${event.candidateCount} candidate rules...`);
        break;
      case 'synthesis_completed':
        spinner.stop();
        logger.verbose(
          chalk.gray(
            `  Refined: ${event.candidateCount} candidates → ${event.finalCount} rules (${(event.durationMs / 1000).toFixed(1)}s)`
          )
        );
        break;
      case 'generator_complete':
        spinner.stop();
        break;
    }
  };

  const result = await generateRules({
    configPath: argv.config,
    onProgress,
    abortSignal: argv.abortSignal,
  });

  spinner.stop();

  if (result.rules.length === 0) {
    console.log(chalk.yellow('No rules were generated. The agent did not find patterns worth codifying.'));
    return 0;
  }

  // Interactive review if running in a TTY
  let accepted: RulePolicy[];
  if (process.stdin.isTTY) {
    accepted = await reviewRulesInteractively(result.rules);
  } else {
    accepted = result.rules;
  }

  if (accepted.length === 0) {
    console.log(chalk.yellow('\nNo rules accepted.'));
    return 0;
  }

  writeGeneratedRules(accepted);

  const durationSec = (result.summary.durationMs / 1000).toFixed(1);
  const { inputTokens, outputTokens } = result.summary;
  const tokenStr = `${(inputTokens / 1000).toFixed(1)}K input + ${(outputTokens / 1000).toFixed(1)}K output`;

  console.log(chalk.green(`\n${accepted.length} rule(s) written to .mesa/rules/`));
  if (accepted.length < result.rules.length) {
    console.log(chalk.gray(`  (${result.rules.length - accepted.length} rule(s) skipped)`));
  }
  console.log(chalk.gray(`  Files scanned: ${result.summary.filesScanned}`));
  console.log(chalk.gray(`  Duration:      ${durationSec}s`));
  console.log(chalk.gray(`  Tokens:        ${tokenStr}`));
  const config = loadValidatedConfig(argv.config);
  const cost = estimateCost(config.model.name, inputTokens, outputTokens);
  if (cost !== undefined) {
    console.log(chalk.gray(`  Est. cost:     ~$${cost.toFixed(2)}`));
  }

  return 0;
}

async function reviewRulesInteractively(rules: RulePolicy[]): Promise<RulePolicy[]> {
  console.log(chalk.bold(`\n${rules.length} rule(s) generated. Review each rule:\n`));

  const accepted: RulePolicy[] = [];

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    printRule(i + 1, rules.length, rule);

    const action = await askReviewAction();

    if (action === 'yes') {
      accepted.push(rule);
      console.log(chalk.green('  ✓ Accepted\n'));
    } else if (action === 'edit') {
      const edited = openInEditor(rule);
      if (edited) {
        accepted.push(edited);
        console.log(chalk.green('  ✓ Accepted (edited)\n'));
      } else {
        console.log(chalk.yellow('  ✗ Edit failed or cancelled, skipping\n'));
      }
    } else {
      console.log(chalk.gray('  ✗ Skipped\n'));
    }
  }

  return accepted;
}

function printRule(index: number, total: number, rule: RulePolicy): void {
  const severityColor = rule.severity === 'error' ? chalk.red : rule.severity === 'warning' ? chalk.yellow : chalk.blue;

  console.log(chalk.bold(`─── Rule ${index}/${total}: ${rule.id} ───`));
  console.log(`  ${chalk.bold('Title:')}    ${rule.title}`);
  console.log(`  ${chalk.bold('Severity:')} ${severityColor(rule.severity)}`);
  console.log(`  ${chalk.bold('Globs:')}    ${rule.globs.join(', ')}`);
  console.log(`  ${chalk.bold('Instructions:')}`);
  for (const line of rule.instructions.trim().split('\n')) {
    console.log(`    ${chalk.gray(line)}`);
  }
  console.log('');
}

type ReviewAction = 'yes' | 'no' | 'edit';

function askReviewAction(): Promise<ReviewAction> {
  console.log(`  ${chalk.bold('[Y]es')} / ${chalk.bold('[N]o')} / ${chalk.bold('[E]dit')}`);
  process.stdout.write('  > ');

  const rl = createReadline();
  return new Promise((resolve) => {
    rl.once('line', (answer: string) => {
      rl.close();
      const input = answer.trim().toLowerCase();
      if (input === 'y' || input === 'yes' || input === '') {
        resolve('yes');
      } else if (input === 'e' || input === 'edit') {
        resolve('edit');
      } else {
        resolve('no');
      }
    });
  });
}

//This is for $EDITOR support but this is not ideal. Not sure what best UX is.
function ruleToYaml(rule: RulePolicy): string {
  const globs = rule.globs.map((glob) => `  - ${JSON.stringify(glob)}`).join('\n');
  const instructions = rule.instructions
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

  return [
    `id: ${rule.id}`,
    `title: ${JSON.stringify(rule.title)}`,
    `severity: ${rule.severity}`,
    'globs:',
    globs,
    'instructions: |',
    instructions,
    '',
  ].join('\n');
}

function openInEditor(rule: RulePolicy): RulePolicy | null {
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `mesa-rule-${rule.id}.yaml`);

  try {
    fs.writeFileSync(tmpFile, ruleToYaml(rule));

    execFileSync(editor, [tmpFile], { stdio: 'inherit' });

    const edited = fs.readFileSync(tmpFile, 'utf-8');
    const parsed = yaml.load(edited);

    if (!parsed || typeof parsed !== 'object') return null;

    const obj = parsed as Record<string, unknown>;

    // Validate required fields
    if (typeof obj.id !== 'string' || !obj.id) return null;
    if (typeof obj.title !== 'string' || !obj.title) return null;
    if (typeof obj.instructions !== 'string' || !obj.instructions) return null;
    if (!Array.isArray(obj.globs) || obj.globs.length === 0) return null;
    if (obj.severity !== 'error' && obj.severity !== 'warning' && obj.severity !== 'info') return null;

    return {
      id: obj.id,
      title: obj.title,
      severity: obj.severity,
      globs: obj.globs as string[],
      instructions: obj.instructions,
    };
  } catch {
    return null;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // cleanup best-effort
    }
  }
}

function formatExtensions(extensions: Record<string, number>): string {
  return Object.entries(extensions)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([ext, count]) => `.${ext}: ${count}`)
    .join(', ');
}
