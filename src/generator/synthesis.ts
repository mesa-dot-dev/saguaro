import type { LanguageModel } from 'ai';
import { generateObject } from 'ai';
import { Minimatch } from 'minimatch';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import type { RulePolicy } from '../types/types.js';
import { RuleProposalSchema, TriageDecisionSchema } from './schemas.js';

const TRIAGE_PROMPT = `You are a senior engineering lead reviewing candidate code review rules generated from different zones of a codebase.

Your job is to decide which rules to keep, which to drop, and which to merge. Do NOT cut good rules to hit a number — if candidates are distinct and high-quality, keep them all.

## Identify Overlapping Candidates

If two candidates describe the same underlying pattern (even across different packages), mark them for merging. Pick the one with better instructions as the target.

## Identify Bad Rules to Drop

Drop any rule matching these patterns:

**Kitchen sink rules** — A rule that combines multiple unrelated concerns into one. If a rule's instructions contain 3+ distinct "flag X" checks that have nothing to do with each other (e.g., env var conventions AND API request helpers AND redirect sanitization in one rule), it should be split or dropped. Each rule should enforce ONE coherent pattern.

**Generic advice with codebase-specific names** — A rule where the underlying advice is boilerplate that applies to any codebase, just dressed up with specific function/class names from this codebase. Example: "use the logger instead of console.log" is generic advice even if it names the specific logger functions. Test: if you removed the specific names, would the rule still sound like something every codebase should do? If yes, drop it.

**Too niche to trigger** — A rule whose globs match only 1-2 files in the entire codebase. The rule may be technically correct but the surface area is too small to justify including it in a review ruleset. **Exception**: Rules enforcing architectural boundaries (layer separation, dependency direction, I/O purity) are valuable even for small directories because they protect the boundary as the codebase grows — keep them.

**Linter/compiler territory** — Rules about formatting, unused imports, type errors, naming conventions, or anything a linter or compiler already catches.

**Vague or unenforceable** — Rules where the instructions don't give a reviewer a concrete thing to look for. "Ensure code quality" or "follow best practices" are not actionable.

**Redundant with a "don't edit" rule** — If one rule says "do not manually edit files matching glob X" (auto-generated code), then any other rule describing patterns *within* those same files is redundant. No PR should be manually changing auto-generated files, so rules about their internal patterns will never trigger. Drop all such subset rules and keep only the "don't edit" rule.

## Quality Check

For each rule you consider keeping, verify:
- The instructions describe ONE coherent pattern (not a grab bag)
- A reviewer reading just the instructions would know exactly what to flag
- The globs are scoped to the relevant subsystem (not \`**/*.ts\`)

## Output

Classify every candidate ID into exactly one bucket: keep, drop, or merge. Every input ID must appear exactly once across all three lists. For merges, group candidates that describe the same pattern and designate the strongest candidate as the target.`;

const MERGE_PROMPT = `You are merging code review rules that describe the same underlying pattern but were discovered in different zones of a codebase.

Write one unified rule that covers all scopes:
- Union the glob patterns from all source rules
- Write instructions that cover the full scope (don't just concatenate — synthesize)
- Pick the most concrete examples from any source rule
- Keep the target rule's ID

The merged rule must have: id, title, severity, globs, instructions. Include examples if any source rule had them.`;

interface SynthesisResult {
  rules: RulePolicy[];
  inputTokens: number;
  outputTokens: number;
}

export async function synthesizeRules(options: {
  candidates: RulePolicy[];
  model: LanguageModel;
  allSourceFilePaths: string[];
  abortSignal?: AbortSignal;
}): Promise<SynthesisResult> {
  const { candidates, model, allSourceFilePaths, abortSignal } = options;

  if (candidates.length === 0) {
    return { rules: [], inputTokens: 0, outputTokens: 0 };
  }

  const candidatesByID = new Map(candidates.map((r) => [r.id, r]));

  // Step 1: Triage — decisions only, tiny output
  const similarityClusters = computeGlobSimilarityClusters(candidates, allSourceFilePaths);
  const triage = await triageRules({ candidates, model, similarityClusters, abortSignal });
  if (!triage) {
    // Fallback: triage failed, keep all candidates
    return { rules: candidates, inputTokens: 0, outputTokens: 0 };
  }

  // Step 2: Apply keeps/drops deterministically
  const kept: RulePolicy[] = [];
  for (const id of triage.decisions.keep) {
    const rule = candidatesByID.get(id);
    if (rule) kept.push(rule);
  }

  // Fallback: any IDs not mentioned in triage are kept
  const mentionedIDs = new Set([
    ...triage.decisions.keep,
    ...triage.decisions.drop,
    ...triage.decisions.merge.flatMap((m) => [m.target, ...m.sources]),
  ]);
  for (const [id, rule] of candidatesByID) {
    if (!mentionedIDs.has(id)) kept.push(rule);
  }

  // Step 3: Parallel merge writes
  const mergeResults = await mergeRulesInParallel({
    mergeGroups: triage.decisions.merge,
    candidatesByID,
    model,
    abortSignal,
  });

  return {
    rules: [...kept, ...mergeResults.rules],
    inputTokens: triage.inputTokens + mergeResults.inputTokens,
    outputTokens: triage.outputTokens + mergeResults.outputTokens,
  };
}

function formatCandidatesSummary(candidates: RulePolicy[]): string {
  return candidates
    .map((r, i) => {
      const parts = [
        `${i + 1}. **${r.id}** (${r.severity})`,
        `   Title: ${r.title}`,
        `   Globs: ${r.globs.join(', ')}`,
        `   Instructions: ${r.instructions}`,
      ];
      if (r.examples?.violations?.length) {
        parts.push(`   Violations: ${r.examples.violations.join(' | ')}`);
      }
      if (r.examples?.compliant?.length) {
        parts.push(`   Compliant: ${r.examples.compliant.join(' | ')}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

interface SimilarityCluster {
  ruleIds: string[];
  jaccardPercent: number;
}
const JACCARD_THRESHOLD = 0.7;
function computeGlobSimilarityClusters(candidates: RulePolicy[], allSourceFilePaths: string[]): SimilarityCluster[] {
  // Pre-compute compiled globs and matched file sets for each candidate
  const matchSets = new Map<string, Set<string>>();
  for (const rule of candidates) {
    const compiled = rule.globs.map((g) => new Minimatch(g));
    const matched = new Set<string>();
    for (const file of allSourceFilePaths) {
      if (compiled.some((m) => m.match(file))) {
        matched.add(file);
      }
    }
    matchSets.set(rule.id, matched);
  }

  // Pairwise Jaccard similarity — group rules above threshold
  const clustered = new Set<string>();
  const clusters: SimilarityCluster[] = [];

  // Sort for deterministic clustering (greedy pass is order-dependent)
  const ruleIds = candidates.map((r) => r.id).sort();
  for (let i = 0; i < ruleIds.length; i++) {
    if (clustered.has(ruleIds[i]!)) continue;
    const setA = matchSets.get(ruleIds[i]!)!;
    if (setA.size === 0) continue;

    const cluster: string[] = [ruleIds[i]!];
    let bestJaccard = 0;

    for (let j = i + 1; j < ruleIds.length; j++) {
      if (clustered.has(ruleIds[j]!)) continue;
      const setB = matchSets.get(ruleIds[j]!)!;
      if (setB.size === 0) continue;

      let intersection = 0;
      for (const file of setA) {
        if (setB.has(file)) intersection++;
      }

      const union = setA.size + setB.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;
      if (jaccard >= JACCARD_THRESHOLD) {
        cluster.push(ruleIds[j]!);
        bestJaccard = Math.max(bestJaccard, jaccard);
      }
    }

    if (cluster.length > 1) {
      for (const id of cluster) clustered.add(id);
      clusters.push({ ruleIds: cluster, jaccardPercent: Math.round(bestJaccard * 100) });
    }
  }

  return clusters;
}

function formatSimilarityClusters(clusters: SimilarityCluster[]): string {
  if (clusters.length === 0) return '';

  const lines = ['## Glob Similarity Clusters', ''];
  lines.push(
    'The following groups of rules target largely the same set of files (measured by Jaccard similarity). ' +
      'High Jaccard does NOT automatically mean duplicate — multiple distinct rules can legitimately target the same directory. ' +
      'However, rules in the same cluster deserve extra scrutiny: read their instructions carefully and verify each one enforces a genuinely distinct concern. ' +
      'If two rules in a cluster describe the same underlying pattern (even with different wording), merge them.'
  );
  lines.push('');

  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i]!;
    lines.push(
      `Cluster ${i + 1} (${cluster.jaccardPercent}% Jaccard — these rules have a decent chance of being duplicates or merge-able): ${cluster.ruleIds.join(', ')}`
    );
  }

  lines.push('');
  return lines.join('\n');
}

interface TriageResult {
  decisions: z.infer<typeof TriageDecisionSchema>;
  inputTokens: number;
  outputTokens: number;
}

async function triageRules(options: {
  candidates: RulePolicy[];
  model: LanguageModel;
  similarityClusters: SimilarityCluster[];
  abortSignal?: AbortSignal;
}): Promise<TriageResult | null> {
  const { candidates, model, similarityClusters, abortSignal } = options;

  const candidatesSummary = formatCandidatesSummary(candidates);
  const allIDs = candidates.map((r) => r.id);
  const clusterSection = formatSimilarityClusters(similarityClusters);

  const userPrompt = `## ${candidates.length} Candidate Rules

${candidatesSummary}

${clusterSection}## Available IDs

${allIDs.join(', ')}

Classify every candidate ID into exactly one bucket: keep, drop, or merge.`;

  try {
    const result = await generateObject({
      model,
      schema: TriageDecisionSchema,
      system: TRIAGE_PROMPT,
      prompt: userPrompt,
      abortSignal,
    });

    return {
      decisions: result.object,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    logger.debug(`Triage step failed, keeping all candidates: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

type MergeGroup = z.infer<typeof TriageDecisionSchema>['merge'][number];

interface MergeResults {
  rules: RulePolicy[];
  inputTokens: number;
  outputTokens: number;
}

async function mergeRulesInParallel(options: {
  mergeGroups: MergeGroup[];
  candidatesByID: Map<string, RulePolicy>;
  model: LanguageModel;
  abortSignal?: AbortSignal;
}): Promise<MergeResults> {
  const { mergeGroups, candidatesByID, model, abortSignal } = options;

  if (mergeGroups.length === 0) {
    return { rules: [], inputTokens: 0, outputTokens: 0 };
  }

  const results = await Promise.all(
    mergeGroups.map((group) => mergeSingleGroup({ group, candidatesByID, model, abortSignal }))
  );

  return {
    rules: results.map((r) => r.rule),
    inputTokens: results.reduce((sum, r) => sum + r.inputTokens, 0),
    outputTokens: results.reduce((sum, r) => sum + r.outputTokens, 0),
  };
}

async function mergeSingleGroup(options: {
  group: MergeGroup;
  candidatesByID: Map<string, RulePolicy>;
  model: LanguageModel;
  abortSignal?: AbortSignal;
}): Promise<{ rule: RulePolicy; inputTokens: number; outputTokens: number }> {
  const { group, candidatesByID, model, abortSignal } = options;

  const target = candidatesByID.get(group.target);
  const sources = group.sources.map((id) => candidatesByID.get(id)).filter(Boolean) as RulePolicy[];

  // If we can't find the rules, fall back to the target as-is
  if (!target) {
    const fallback = sources[0] ?? {
      id: group.target,
      title: '',
      severity: 'warning' as const,
      globs: [],
      instructions: '',
    };
    return { rule: fallback, inputTokens: 0, outputTokens: 0 };
  }

  if (sources.length === 0) {
    return { rule: target, inputTokens: 0, outputTokens: 0 };
  }

  const allRules = [target, ...sources];
  const rulesSummary = formatCandidatesSummary(allRules);

  const userPrompt = `## Rules to Merge

Target rule ID: ${target.id}

${rulesSummary}

Merge reason: ${group.reason}

Write one unified rule using the target's ID (${target.id}).`;

  try {
    const result = await generateObject({
      model,
      schema: z.object({ rule: RuleProposalSchema }),
      system: MERGE_PROMPT,
      prompt: userPrompt,
      abortSignal,
    });

    return {
      rule: result.object.rule,
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
    };
  } catch (err) {
    if (abortSignal?.aborted) throw err;
    logger.debug(
      `Merge failed for group ${group.target}, keeping target as-is: ${err instanceof Error ? err.message : String(err)}`
    );
    return { rule: target, inputTokens: 0, outputTokens: 0 };
  }
}
