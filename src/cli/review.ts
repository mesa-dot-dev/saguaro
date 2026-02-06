import { printViolations } from '../agent/output.js';
import { runReviewAgent } from '../agent/runner.js';
import { BUILD_TIME } from '../build-info.js';
import type { Rule } from '../types/types.js';
import { getChangedFiles } from './lib/git.js';
import { loadAllRules, selectRulesForFiles } from './lib/selector.js';

interface ReviewOptions {
  base: string;
  output: 'console' | 'json';
  rules?: string;
  verbose?: boolean;
  config?: string;
}

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  // 1. Get changed files
  let changedFiles: string[];
  try {
    changedFiles = getChangedFiles(options.base);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  if (changedFiles.length === 0) {
    if (options.verbose) console.log('No changed files found.');
    process.exit(0);
  }

  if (options.verbose) {
    console.log(`Build: ${BUILD_TIME}`);
    console.log(`\nFound ${changedFiles.length} changed files:`);
    changedFiles.forEach((f) => console.log(`  ${f}`));
  }

  // 2. Load and select rules
  const rules = loadAllRules(options.rules);
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
    const startTime = Date.now();
    const result = await runReviewAgent({
      baseBranch: options.base,
      filesWithRules: filesWithRules as Map<string, Rule[]>,
      configPath: options.config,
      verbose: options.verbose,
    });
    result.summary.durationMs = Date.now() - startTime;

    printViolations(result, options.output);

    // Exit with appropriate code
    const hasErrors = result.violations.some((v) => v.severity === 'error');
    process.exit(hasErrors ? 1 : 0);
  } catch (e: any) {
    console.error(`Agent error: ${e.message}`);
    process.exit(3);
  }
}
