import fs from 'node:fs';
import path from 'node:path';
import boxen from 'boxen';
import chalk from 'chalk';
import {
  createRuleAdapter,
  deleteRuleAdapter,
  explainRuleAdapter,
  listRulesAdapter,
  locateRulesDirectoryAdapter,
  validateRulesAdapter,
} from '../../adapter/rules.js';
import { loadValidatedConfig, resolveApiKey, resolveModelFromResolvedConfig } from '../../lib/review-model-config.js';
import { generateRule } from '../../lib/rule-generator.js';
import { previewRule } from '../../lib/rule-preview.js';
import { findRepoRoot } from '../../lib/rule-resolution.js';
import { discoverScopeOptions } from '../../lib/scope-discovery.js';
import { analyzeTarget } from '../../lib/target-analysis.js';
import { resolveTargetInput } from '../../lib/target-resolver.js';
import type { Severity } from '../../types/types.js';
import { ask, askChoice, createReadline } from './prompt.js';
import { CliSpinner } from './spinner.js';

interface ExplainRuleArgv {
  ruleId: string;
}

interface DeleteRuleArgv {
  ruleId: string;
}

interface CreateRuleArgv {
  target?: string;
  intent?: string;
  debug?: boolean;
  skipPreview?: boolean;
  title?: string;
  severity?: string;
}

const listRules = () => {
  const result = listRulesAdapter();
  const rules = result.rules;
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
  const result = explainRuleAdapter({ ruleId: argv.ruleId });
  const rule = result.rule;
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
  const result = deleteRuleAdapter({ ruleId: argv.ruleId });
  if (!result.deleted) {
    console.log(chalk.red(`Rule not found: ${argv.ruleId}`));
    return;
  }
  console.log(chalk.green(`Deleted: ${argv.ruleId}`));
};

const validateRules = (): number => {
  const result = validateRulesAdapter();
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

function buildScopeChoices(repoRoot: string) {
  return discoverScopeOptions(repoRoot).map((opt) => ({
    id: opt.path,
    label: opt.path === '.' ? opt.label : `${opt.path} (${opt.type === 'existing-skills' ? 'has rules' : 'package'})`,
  }));
}

const createRule = async (argv: CreateRuleArgv): Promise<number> => {
  if (!process.stdin.isTTY && !argv.intent) {
    console.log(chalk.red('Interactive terminal required for rule creation, or provide --intent flag.'));
    return 1;
  }

  const repoRoot = findRepoRoot();
  const rl = createReadline();

  try {
    // 1. Target selection
    let targetPath = argv.target;
    if (!targetPath && process.stdin.isTTY) {
      const raw = await ask(rl, 'What code should this rule check? (path, keyword, or "global")');
      const resolution = resolveTargetInput(raw, repoRoot);

      switch (resolution.type) {
        case 'exact':
          targetPath = resolution.path;
          console.log(chalk.green(`✓ Target: ${targetPath === '.' ? 'repo-wide' : targetPath}`));
          break;

        case 'search':
          if (resolution.matches.length === 0) {
            console.log(chalk.yellow(`No directories found matching "${raw}". Showing all packages...`));
            const selected = await askChoice(rl, 'What code should this rule check?', buildScopeChoices(repoRoot));
            targetPath = selected.id;
          } else {
            const searchChoices = resolution.matches.map((m) => ({ id: m, label: m }));
            const selected = await askChoice(rl, `Found directories matching "${raw}":`, searchChoices);
            targetPath = selected.id;
          }
          break;

        case 'browse': {
          const selected = await askChoice(rl, 'What code should this rule check?', buildScopeChoices(repoRoot));
          targetPath = selected.id;
          break;
        }
      }
    }

    if (!targetPath) {
      console.log(chalk.red('No target specified. Use: mesa rules create <target>'));
      return 1;
    }

    // 2. Intent collection
    let intent = argv.intent;
    if (!intent && process.stdin.isTTY) {
      intent = await ask(rl, 'What should be different about this code?');
    }

    if (!intent) {
      console.log(chalk.red('No intent specified. Use: mesa rules create <target> --intent "..."'));
      return 1;
    }

    // Close readline before spinner — they conflict on stdin
    rl.close();

    // 3. Set up debug logging
    let debugLog: ((label: string, content: string) => void) | undefined;
    let debugLogPath: string | undefined;
    if (argv.debug) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      debugLogPath = path.resolve(findRepoRoot(), '.mesa', '.tmp', `rule-create-${timestamp}.txt`);
      fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
      fs.writeFileSync(debugLogPath, `=== Mesa Rule Create Debug ${new Date().toISOString()} ===\n\n`);
      debugLog = (label: string, content: string) => {
        const entry = `--- ${label} [${new Date().toISOString()}] ---\n${content}\n\n`;
        fs.appendFileSync(debugLogPath!, entry);
      };
      debugLog('Input', `target=${targetPath}\nintent=${intent}`);
      console.log(chalk.gray(`[debug] Writing debug log to ${debugLogPath}`));
    }

    // 4. Analyze target
    const target = analyzeTarget({ targetPath, repoRoot });
    console.log(
      chalk.gray(
        `Analyzed ${chalk.bold(target.relativePath)}: ${target.files.length} files, ` +
          `detected: ${target.detectedLanguages.join(', ') || 'unknown'}`
      )
    );
    debugLog?.(
      'Target analysis',
      JSON.stringify(
        {
          resolvedPath: target.resolvedPath,
          relativePath: target.relativePath,
          fileCount: target.files.length,
          languages: target.detectedLanguages,
          globs: target.suggestedGlobs,
          placements: target.placements.length,
        },
        null,
        2
      )
    );

    // 5. Generate rule via LLM
    const spinner = new CliSpinner();
    spinner.start('Generating rule...');

    try {
      const config = loadValidatedConfig();
      const apiKey = resolveApiKey(config);
      const model = resolveModelFromResolvedConfig({
        provider: config.model.provider,
        model: config.model.name,
        apiKey,
      });

      const result = await generateRule({
        intent,
        target,
        model,
        title: argv.title,
        severity: argv.severity as Severity | undefined,
        repoRoot,
        debugLog,
      });

      spinner.stop();

      const policy = result.policy;

      // 6. Preview (unless --no-preview)
      if (!argv.skipPreview && policy.examples?.violations?.length) {
        const preview = previewRule({
          targetDir: repoRoot,
          globs: policy.globs,
          violationPatterns: policy.examples.violations,
        });

        console.log('');
        console.log(chalk.bold(`Generated: ${policy.title}`) + chalk.gray(` (${policy.severity})`));
        console.log(chalk.gray(`Target: ${policy.globs.join(', ')}`));
        console.log('');

        if (preview.flaggedCount > 0) {
          console.log(chalk.red(`Would flag (${preview.flaggedCount} files):`));
          for (const file of preview.flagged.slice(0, 5)) {
            const relPath = path.relative(repoRoot, file.filePath);
            if (file.matches.length > 0) {
              const match = file.matches[0];
              console.log(
                chalk.red(`  ✗ ${relPath}:${match.line}`) + chalk.gray(` — ${match.content.trim().slice(0, 60)}`)
              );
            } else {
              console.log(chalk.red(`  ✗ ${relPath}`));
            }
          }
          if (preview.flaggedCount > 5) {
            console.log(chalk.gray(`  ... and ${preview.flaggedCount - 5} more`));
          }
        }

        if (preview.passedCount > 0) {
          console.log(chalk.green(`\nWould pass (${preview.passedCount} files):`));
          for (const file of preview.passed.slice(0, 3)) {
            const relPath = path.relative(repoRoot, file.filePath);
            console.log(chalk.green(`  ✓ ${relPath}`));
          }
          if (preview.passedCount > 3) {
            console.log(chalk.gray(`  ... and ${preview.passedCount - 3} more`));
          }
        }

        if (preview.flaggedCount === 0 && preview.passedCount === 0) {
          console.log(chalk.yellow('No files matched the target globs.'));
        }

        console.log('');

        // Ask for confirmation (re-open readline)
        if (process.stdin.isTTY) {
          const confirmRl = createReadline();
          try {
            const action = await ask(confirmRl, '[A]ccept, [C]ancel');
            const choice = action.toLowerCase().trim();
            if (choice === 'c' || choice === 'cancel') {
              console.log(chalk.gray('Cancelled.'));
              return 0;
            }
          } finally {
            confirmRl.close();
          }
        }
      }

      // 7. Write to disk
      const created = createRuleAdapter({
        title: policy.title,
        severity: policy.severity,
        globs: policy.globs,
        instructions: policy.instructions,
        id: policy.id,
        repoRoot,
        examples: policy.examples,
      });

      debugLog?.('Written to', `policy: ${created.policyFilePath}`);
      console.log(chalk.green(`\nCreated: ${created.policyFilePath}`));
      if (debugLogPath) {
        console.log(chalk.gray(`Debug log: ${debugLogPath}`));
      }
      return 0;
    } catch (error) {
      spinner.stop();
      const message = error instanceof Error ? error.message : String(error);
      debugLog?.('Error', message);
      console.log(chalk.red(`\nFailed to generate rule: ${message}`));
      return 1;
    }
  } finally {
    rl.close();
  }
};

const locateRulesDirectory = (): number => {
  const result = locateRulesDirectoryAdapter();
  console.log(chalk.gray(result.rulesDir));
  return 0;
};

export { createRule, deleteRule, explainRule, listRules, locateRulesDirectory, validateRules };
