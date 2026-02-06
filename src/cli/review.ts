import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import { fileURLToPath } from 'url';
import { printViolations } from '../agent/output.js';
import { runReviewAgent } from '../agent/runner.js';
import type { Rule } from '../types/types.js';
import { getChangedFiles } from './lib/git.js';
import { loadAllRules, selectRulesForFiles } from './lib/selector.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8'));
const VERSION: string = pkg.version;

interface ReviewOptions {
  base?: string;
  output: 'console' | 'json';
  rules?: string;
  verbose?: boolean;
  config?: string;
}

interface MesaOutputConfig {
  output?: {
    cursor_deeplink?: boolean;
  };
}

interface OutputSettings {
  cursorDeeplink: boolean;
}

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  const startTime = Date.now();
  const outputSettings = resolveOutputSettings(options.config);

  // 1. Get changed files and load rules in parallel (they're independent operations)
  let changedFiles: string[];
  let rules: Rule[];

  try {
    [changedFiles, rules] = await Promise.all([
      Promise.resolve(getChangedFiles(options.base ?? 'main')),
      Promise.resolve(loadAllRules(options.rules)),
    ]);
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    if (options.verbose) console.log('No changed files found.');
    process.exit(0);
  }

  if (options.verbose) {
    console.log(`Mesa v${VERSION}`);
    console.log(`\nFound ${changedFiles.length} changed files:`);
    changedFiles.forEach((f) => console.log(`  ${f}`));
  }

  // 2. Select applicable rules for files
  const filesWithRules: Map<string, Rule[]> = selectRulesForFiles(changedFiles, rules);

  const totalRulesToCheck = Array.from(filesWithRules.values()).reduce((acc, r) => acc + r.length, 0);

  if (options.verbose || totalRulesToCheck > 0) {
    console.log(`\nRule Selection:`);
    console.log(`  ${rules.length} total rules loaded.`);
    console.log(`  ${filesWithRules.size} files have applicable rules.`);
    console.log(`  ${totalRulesToCheck} total checks to perform.`);
  }

  if (filesWithRules.size === 0) {
    console.log('No rules matched the changed files. Review passed.');
    process.exit(0);
  }
  // 3. Run agent
  if (options.verbose) {
    console.log('\nRunning code review agent...');
  }

  try {
    const result = await runReviewAgent({
      baseBranch: options.base ?? 'main',
      filesWithRules: filesWithRules as Map<string, Rule[]>,
      configPath: options.config,
      verbose: options.verbose,
    });

    result.summary.durationMs = Date.now() - startTime;

    // 4. Output results
    printViolations(result, options.output, outputSettings.cursorDeeplink, !!options.verbose);

    // Exit with appropriate code
    const hasErrors = result.violations.some((v) => v.severity === 'error');
    process.exit(hasErrors ? 1 : 0);
  } catch (e) {
    console.error(`Agent error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(3);
  }
}

function resolveOutputSettings(configPath?: string): OutputSettings {
  const resolvedPath = configPath ?? '.mesa/config.yaml';
  if (!fs.existsSync(resolvedPath)) {
    throw new Error('No config file found. Run "mesa init --force" to regenerate .mesa/config.yaml.');
  }

  try {
    const parsed = yaml.load(fs.readFileSync(resolvedPath, 'utf8')) as MesaOutputConfig | null;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('expected YAML object');
    }

    const cursorDeeplink = parsed.output?.cursor_deeplink;

    if (typeof cursorDeeplink !== 'boolean') {
      throw new Error('output.cursor_deeplink is required and must be true or false');
    }

    return {
      cursorDeeplink,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse ${resolvedPath}: ${message}`);
  }
}
