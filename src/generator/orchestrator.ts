import path from 'node:path';
import yaml from 'js-yaml';
import { Minimatch } from 'minimatch';
import { z } from 'zod';
import { findRepoRoot } from '../git/git.js';
import { buildIndex } from '../indexer/build.js';
import { JsonIndexStore } from '../indexer/store.js';
import type { CodebaseIndex } from '../indexer/types.js';
import { STARTER_RULES } from '../templates/starter-rules.js';
import type { RulePolicy } from '../types/types.js';
import { logger } from '../util/logger.js';
import { computeArchitecturalContext } from './architecture.js';
import type { GeneratorLlmBackend } from './llm-backend.js';
import { resolveGeneratorBackend } from './llm-backend.js';
import { scanAndSelectFiles } from './scanner.js';
import { RuleProposalSchema } from './schemas.js';
import { synthesizeRules } from './synthesis.js';
import type { GenerateRulesOptions, GeneratorResult, ScanResult, ZoneAnalysisResult, ZoneConfig } from './types.js';

/** Pick a diverse fixed set of starter rules as few-shot references for zone analysis. */
const FEW_SHOT_IDS = ['no-floating-promises', 'missing-effect-cleanup', 'n-plus-one-query'] as const;
const FEW_SHOT_EXAMPLES = STARTER_RULES.filter((r) => (FEW_SHOT_IDS as readonly string[]).includes(r.id));

const ZONE_ANALYSIS_SYSTEM = `You are a senior developer extracting code review rules from a zone of a codebase.

Your goal is to discover the patterns and conventions that a senior reviewer would enforce on every PR touching this area.

## What Makes a Good Rule

Rules capture what a senior reviewer carries in their head:
- **Architecture enforcement**: "We use Drizzle query builder, not raw SQL", "Auth flows go through this middleware", "API routes follow this structure"
- **Bug prevention**: silent error swallowing, injection risks, race conditions, missing validation at system boundaries
- **Conventions specific to this codebase**: patterns you discover by reading the actual code, not generic best practices

Each rule should represent a distinct, reusable pattern — not a description of what one specific function does.

## Architectural Boundaries

Pay attention to how the codebase is structured, not just how individual files are written:
- **Layer separation**: Directories with no I/O imports (node:fs, node:child_process) are pure logic layers. Protect this boundary.
- **Dependency direction**: If directory A never imports from directory B, that's likely intentional. Enforce unidirectional dependency flow.
- **Interface boundaries**: Directories that define interfaces implemented elsewhere represent abstraction layers.

If an Architectural Overview section is provided, use it to identify these structural patterns.

## What NOT To Emit

- Rules that duplicate linters/compilers (formatting, unused imports, type errors)
- Rules about a single specific function rather than a reusable pattern
- Vague or unenforceable rules ("ensure code quality", "follow best practices")
- Rules about test fixtures, eval data, or generated files
- Meta/self-referential rules (rules about rules)
- Generic best practices that apply to any codebase (e.g., "don't commit secrets", "use HTTPS"). Only emit rules that reflect patterns specific to THIS codebase.
- **Aspirational rules** — only emit rules about patterns you directly observed in the **source code files** below. Documentation and config files are provided for context only; if a pattern appears only in docs but not in the actual code, do not emit a rule for it.

## Glob Scoping

Scope globs to the zone's directory structure. Use paths like \`src/subsystem/**/*.ts\`, not \`**/*.ts\`.

## Instructions Quality

Each rule's instructions field will be read by a different AI to enforce the rule on git diffs. Write instructions that are specific and actionable — a reviewer should know exactly what to flag and what's acceptable.

When referencing specific patterns (regex, function names, file paths), verify them against the code provided above. Do not guess — if you cannot confirm a detail from the provided code, leave it out of the instructions.`;

function zoneRuleTarget(sourceFileCount: number): number {
  if (sourceFileCount < 30) return 10;
  if (sourceFileCount < 100) return 15;
  return 20;
}

/** Minimum instruction length to be considered actionable (not vague). */
const MIN_INSTRUCTIONS_LENGTH = 80;

/** Globs that match everything — a sign the rule isn't scoped to a subsystem. */
const UNSCOPED_GLOB_PATTERNS = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*'];

export async function orchestrate(options: GenerateRulesOptions): Promise<GeneratorResult> {
  const cwd = options.cwd ?? process.cwd();
  const startMs = Date.now();
  const backend = resolveGeneratorBackend(options.configPath);
  options.onProgress?.({ type: 'indexing' });
  const repoRoot = findRepoRoot(cwd);
  const saguaroCacheDir = path.join(repoRoot, '.saguaro', 'cache');
  const store = new JsonIndexStore(saguaroCacheDir);
  let index: CodebaseIndex | null = null;
  try {
    index = await buildIndex({ rootDir: cwd, store });
  } catch {
    // Index build failed — proceed without it (file selection falls back to heuristics)
  }
  const scanResult = scanAndSelectFiles(cwd, repoRoot, index);

  options.onProgress?.({
    type: 'scan_complete',
    totalFiles: scanResult.totalSourceFiles,
    zoneCount: scanResult.zones.length,
    extensions: scanResult.extensions,
  });

  const cwdOffset = path.relative(repoRoot, cwd).replaceAll('\\', '/');
  const zoneResults = await analyzeZonesInParallel(
    scanResult,
    backend,
    index,
    cwdOffset,
    options.onProgress,
    options.abortSignal
  );

  let totalInputTokens = zoneResults.reduce((sum, r) => sum + r.inputTokens, 0);
  let totalOutputTokens = zoneResults.reduce((sum, r) => sum + r.outputTokens, 0);

  const allCandidates = zoneResults.flatMap((r) => r.rules);
  const allSourceFilePaths = scanResult.zones.flatMap((z) => z.files);
  const merged = deterministicMerge(allCandidates, allSourceFilePaths);

  let finalRules: RulePolicy[];

  if (merged.length > 0) {
    options.onProgress?.({
      type: 'synthesis_started',
      candidateCount: merged.length,
    });

    const synthesisStartMs = Date.now();

    const synthesisResult = await synthesizeRules({
      candidates: merged,
      backend,
      allSourceFilePaths,
      abortSignal: options.abortSignal,
    });

    totalInputTokens += synthesisResult.inputTokens;
    totalOutputTokens += synthesisResult.outputTokens;
    finalRules = synthesisResult.rules;

    options.onProgress?.({
      type: 'synthesis_completed',
      candidateCount: merged.length,
      finalCount: finalRules.length,
      durationMs: Date.now() - synthesisStartMs,
    });
  } else {
    finalRules = merged;
  }
  const rules: RulePolicy[] = finalRules;
  const durationMs = Date.now() - startMs;

  options.onProgress?.({
    type: 'generator_complete',
    totalRules: rules.length,
    durationMs,
  });

  return {
    rules,
    summary: {
      filesScanned: scanResult.totalSourceFiles,
      rulesGenerated: rules.length,
      durationMs,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    },
  };
}

async function analyzeZonesInParallel(
  scanResult: ScanResult,
  backend: GeneratorLlmBackend,
  index: CodebaseIndex | null,
  cwdOffset: string,
  onProgress: GenerateRulesOptions['onProgress'],
  abortSignal?: AbortSignal
): Promise<ZoneAnalysisResult[]> {
  const promises = scanResult.zones.map((zone) =>
    analyzeZone(zone, scanResult, backend, index, cwdOffset, onProgress, abortSignal)
  );
  return Promise.all(promises);
}

async function analyzeZone(
  zone: ZoneConfig,
  scanResult: ScanResult,
  backend: GeneratorLlmBackend,
  index: CodebaseIndex | null,
  cwdOffset: string,
  onProgress: GenerateRulesOptions['onProgress'],
  abortSignal?: AbortSignal
): Promise<ZoneAnalysisResult> {
  const startMs = Date.now();
  const target = zoneRuleTarget(zone.files.length);

  onProgress?.({
    type: 'zone_started',
    zoneName: zone.name,
    fileCount: zone.files.length,
    selectedFileCount: zone.selectedFiles.length,
  });

  const prompt = buildZonePrompt(zone, scanResult, target, index, cwdOffset);

  try {
    const result = await backend.generateStructured({
      system: ZONE_ANALYSIS_SYSTEM,
      prompt,
      schema: z.object({
        rules: z.array(RuleProposalSchema),
      }),
      abortSignal,
    });

    const rules = result.object.rules.slice(0, target + 5);
    const durationMs = Date.now() - startMs;

    onProgress?.({
      type: 'zone_completed',
      zoneName: zone.name,
      rulesProposed: rules.length,
      durationMs,
    });

    return {
      zoneName: zone.name,
      rules,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    };
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    logger.debug(`Zone ${zone.name} analysis failed, skipping: ${err instanceof Error ? err.message : String(err)}`);
    onProgress?.({
      type: 'zone_completed',
      zoneName: zone.name,
      rulesProposed: 0,
      durationMs: Date.now() - startMs,
    });
    return { zoneName: zone.name, rules: [], inputTokens: 0, outputTokens: 0 };
  }
}

function buildZonePrompt(
  zone: ZoneConfig,
  scanResult: ScanResult,
  target: number,
  index: CodebaseIndex | null,
  cwdOffset: string
): string {
  const lines: string[] = [];

  lines.push(`## Zone: ${zone.name}`);
  lines.push(`${zone.files.length} source files, ${zone.selectedFiles.length} included below.`);
  lines.push(`Target: ~${target} rules. Quality over quantity.`);
  lines.push('');

  // Project context — configs
  if (Object.keys(scanResult.configs).length > 0) {
    lines.push('## Project Configuration');
    for (const [configPath, content] of Object.entries(scanResult.configs)) {
      lines.push(`### ${configPath}`);
      lines.push('```');
      lines.push(content.length > 3000 ? `${content.slice(0, 3000)}\n[truncated]` : content);
      lines.push('```');
      lines.push('');
    }
  }

  // Project context — docs
  if (Object.keys(scanResult.docs).length > 0) {
    lines.push('## Project Documentation (may be outdated — validate against actual code)');
    for (const [docPath, content] of Object.entries(scanResult.docs)) {
      lines.push(`### ${docPath}`);
      lines.push(content);
      lines.push('');
    }
  }

  // Architectural context from import graph — strip cwdOffset so paths
  // match the cwd-scoped index keys.
  const cwdPrefix = cwdOffset ? `${cwdOffset}/` : '';
  const indexFiles = cwdPrefix ? zone.files.map((f) => f.slice(cwdPrefix.length)) : zone.files;
  const archContext = computeArchitecturalContext(index, indexFiles);
  if (archContext) {
    lines.push(archContext);
  }

  // File tree
  lines.push('## File Tree (all source files in this zone)');
  lines.push('```');
  lines.push(zone.files.join('\n'));
  lines.push('```');
  lines.push('');

  // Auto-generated file paths (contents excluded to save token budget)
  if (zone.autoGeneratedPaths.length > 0) {
    lines.push('## Auto-Generated Files (do not emit rules about internal patterns in these files)');
    lines.push('```');
    lines.push(zone.autoGeneratedPaths.join('\n'));
    lines.push('```');
    lines.push('');
  }

  // File contents
  lines.push('## File Contents');
  lines.push('');
  for (const file of zone.selectedFiles) {
    const ext = path.extname(file.path).slice(1) || 'txt';
    const importAnnotation = file.importedByCount > 0 ? ` (imported by ${file.importedByCount} files)` : '';
    lines.push(`### ${file.path}${importAnnotation}`);
    lines.push(`\`\`\`${ext}`);
    lines.push(file.content);
    lines.push('```');
    lines.push('');
  }

  // Few-shot reference examples — teach the LLM the expected output structure
  if (FEW_SHOT_EXAMPLES.length > 0) {
    lines.push('## Reference Examples');
    lines.push('');
    lines.push(
      'Below are existing high-quality rule policies. Study their structure and produce output in the same format.'
    );
    lines.push('');
    for (const example of FEW_SHOT_EXAMPLES) {
      lines.push(`### Example: ${example.title}`);
      lines.push('```yaml');
      lines.push(yaml.dump(example, { noRefs: true, lineWidth: -1 }).trim());
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('### Anti-Examples (do NOT produce rules like these)');
  lines.push('');
  lines.push('**Bad: Generic advice dressed up with codebase-specific names**');
  lines.push('```yaml');
  lines.push('id: use-logger-not-console');
  lines.push('title: Use structured logger instead of console');
  lines.push('severity: warning');
  lines.push('globs: ["src/**/*.ts"]');
  lines.push('instructions: Use the project logger instead of console.log for all logging.');
  lines.push('```');
  lines.push(
    '*Why this is bad: "Use the logger instead of console" is advice that applies to every codebase. Swapping in a specific logger name does not make it codebase-specific.*'
  );
  lines.push('');
  lines.push('**Bad: Kitchen-sink rule combining unrelated concerns**');
  lines.push('```yaml');
  lines.push('id: api-route-best-practices');
  lines.push('title: API route conventions');
  lines.push('severity: error');
  lines.push('globs: ["src/routes/**/*.ts"]');
  lines.push(
    'instructions: All routes must use the auth middleware. Also ensure error responses use the standard format. Also validate env vars at startup.'
  );
  lines.push('```');
  lines.push(
    '*Why this is bad: Three unrelated concerns (auth, error format, env vars) crammed into one rule. Each should be a separate rule with focused instructions.*'
  );
  lines.push('');

  lines.push('Extract review rules from both the code patterns and architectural structure you observe.');

  return lines.join('\n');
}

function deterministicMerge(candidates: RulePolicy[], allSourceFilePaths: string[]): RulePolicy[] {
  const byId = new Map<string, RulePolicy>();
  for (const rule of candidates) {
    const existing = byId.get(rule.id);
    if (!existing) {
      byId.set(rule.id, rule);
      continue;
    }
    // Keep whichever matches more files
    const existingMatches = countGlobMatches(existing.globs, allSourceFilePaths);
    const newMatches = countGlobMatches(rule.globs, allSourceFilePaths);
    if (newMatches > existingMatches) {
      byId.set(rule.id, rule);
    }
  }

  return [...byId.values()].filter((rule) => {
    // Format validation
    if (!rule.id || !rule.instructions || rule.instructions.trim().length === 0) return false;
    if (!rule.globs || rule.globs.length === 0) return false;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(rule.id)) return false;
    const matchCount = countGlobMatches(rule.globs, allSourceFilePaths);
    const directoryScoped = rule.globs.every((g) => g.includes('/') && !UNSCOPED_GLOB_PATTERNS.includes(g));
    const minMatches = directoryScoped ? 1 : 2;
    if (matchCount < minMatches) return false;

    // Unscoped globs: every glob is a universal wildcard with no directory prefix
    const allUnscoped = rule.globs.every((g) => UNSCOPED_GLOB_PATTERNS.includes(g));
    if (allUnscoped) return false;

    // Vague instructions: too short to be actionable
    if (rule.instructions.trim().length < MIN_INSTRUCTIONS_LENGTH) return false;

    return true;
  });
}

function countGlobMatches(globs: string[], files: string[]): number {
  const compiled = globs.map((g) => new Minimatch(g));
  let count = 0;
  for (const file of files) {
    if (compiled.some((m) => m.match(file))) {
      count++;
    }
  }
  return count;
}
