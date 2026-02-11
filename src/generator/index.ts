import fs from 'node:fs';
import path from 'node:path';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Rule } from '../types/types.js';
import { generateRules } from './generate.js';
import { buildScanContext, type ScanContext } from './scan.js';

const GENERATION_MODEL = 'claude-sonnet-4-5';
export interface GenerateRulesConfig {
  apiKey: string;
}

export interface GenerateAndWriteOptions {
  count?: number;
  force?: boolean;
}

export interface GenerateAndWriteResult {
  written: Rule[];
  skipped: Rule[];
  scanContext: ScanContext;
}

export async function generateAndWriteRules(
  repoRoot: string,
  config: GenerateRulesConfig,
  options: GenerateAndWriteOptions = {}
): Promise<GenerateAndWriteResult> {
  const { count = 8, force = false } = options;

  const rulesDir = path.join(repoRoot, '.mesa', 'rules');
  fs.mkdirSync(rulesDir, { recursive: true });

  const scanContext = buildScanContext(repoRoot);

  if (scanContext.fileTree.length < 3) {
    return { written: [], skipped: [], scanContext };
  }

  const model = createAnthropic({ apiKey: config.apiKey })(GENERATION_MODEL);
  const generatedRules = await generateRules(scanContext, model, count);

  const existingIds = loadExistingRuleIds(rulesDir);

  const written: Rule[] = [];
  const skipped: Rule[] = [];

  for (const rule of generatedRules) {
    if (existingIds.has(rule.id) && !force) {
      skipped.push(rule);
      continue;
    }

    const filename = buildUniqueFilename(rulesDir, rule.id);
    fs.writeFileSync(path.join(rulesDir, filename), ruleToYaml(rule));
    written.push(rule);
  }

  return { written, skipped, scanContext };
}
export { generateRules } from './generate.js';
export { buildScanContext, type FileSample, type ManifestInfo, type ScanContext } from './scan.js';

function loadExistingRuleIds(rulesDir: string): Set<string> {
  const ids = new Set<string>();
  if (!fs.existsSync(rulesDir)) return ids;

  const files = fs.readdirSync(rulesDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  for (const file of files) {
    const content = fs.readFileSync(path.join(rulesDir, file), 'utf8');
    const idMatch = content.match(/^id:\s*(.+)$/m);
    if (idMatch) ids.add(idMatch[1].trim());
  }

  return ids;
}

function buildUniqueFilename(rulesDir: string, baseName: string): string {
  let candidate = `${baseName}.yaml`;
  let i = 2;

  while (fs.existsSync(path.join(rulesDir, candidate))) {
    candidate = `${baseName}-${i}.yaml`;
    i += 1;
  }

  return candidate;
}

function ruleToYaml(rule: Rule): string {
  const lines: string[] = [];

  lines.push(`id: ${rule.id}`);
  lines.push(`title: ${JSON.stringify(rule.title)}`);
  lines.push(`severity: ${rule.severity}`);

  lines.push('globs:');
  for (const glob of rule.globs) {
    lines.push(`  - ${JSON.stringify(glob)}`);
  }

  lines.push('instructions: |');
  for (const line of rule.instructions.split('\n')) {
    lines.push(`  ${line}`);
  }

  lines.push('');
  return lines.join('\n');
}
