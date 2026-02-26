import path from 'node:path';
import { getCodebaseContext } from '../indexer/index.js';
import { getDiffsForFiles } from '../lib/git.js';
import type { AgentName } from './agent-cli.js';
import { invokeAgent } from './agent-cli.js';
import type { ChangedFile, DaemonStore, Finding } from './store.js';

export interface WorkerConfig {
  agent: AgentName;
  model?: string;
  blastRadiusDepth: number;
  contextTokenBudget: number;
}

/**
 * Attempt to claim and process one review job.
 * Returns true if a job was processed (success or failure), false if no jobs available.
 */
export async function runWorker(store: DaemonStore, workerId: number, config: WorkerConfig): Promise<boolean> {
  const job = store.claimNextJob(workerId);
  if (!job) return false;

  try {
    const jobFiles: ChangedFile[] = JSON.parse(job.changedFiles);

    // Determine which files actually need review (diff hash changed or new)
    const previousHashes = store.getReviewedDiffHashes(job.sessionId);
    const filesToReview = jobFiles.filter((f) => {
      const prevHash = previousHashes.get(f.path);
      return !prevHash || prevHash !== f.diff_hash;
    });

    // All files already reviewed with same hash — auto-pass
    if (filesToReview.length === 0) {
      store.completeJob(job.id, 'done', config.model ?? config.agent);
      store.insertReview({ jobId: job.id, verdict: 'pass', findings: null });
      return true;
    }

    const filePaths = filesToReview.map((f) => f.path);
    const diffs = getDiffsForFiles(filePaths, job.repoPath);

    // Blast radius context (best-effort, never blocks)
    let codebaseContext = '';
    try {
      codebaseContext = await getCodebaseContext({
        rootDir: job.repoPath,
        cacheDir: path.join(job.repoPath, '.mesa', 'cache'),
        changedFiles: filePaths,
        blastRadiusDepth: config.blastRadiusDepth,
        tokenBudget: config.contextTokenBudget,
      });
    } catch {
      // Indexing failure never blocks review
    }

    const prompt = buildStaffEngineerPrompt({
      diffs,
      agentSummary: job.agentSummary,
      codebaseContext,
    });

    const output = await invokeAgent(config.agent, prompt, job.repoPath, config.model);
    const findings = parseFindings(output);
    const verdict = findings.length > 0 ? 'fail' : 'pass';

    store.completeJob(job.id, 'done', config.model ?? config.agent);
    store.insertReview({ jobId: job.id, verdict, findings: findings.length > 0 ? findings : null });
    return true;
  } catch (error) {
    console.error(`[mesa-daemon] Worker ${workerId} failed job ${job.id}:`, error);
    store.completeJob(job.id, 'failed', config.model ?? config.agent);
    store.insertReview({ jobId: job.id, verdict: 'pass', findings: null });
    return true;
  }
}

function buildStaffEngineerPrompt(opts: {
  diffs: Map<string, string>;
  agentSummary: string | null;
  codebaseContext: string;
}): string {
  const sections: string[] = [];

  sections.push('You are a senior staff engineer performing an independent code review.');
  sections.push('You only see code diffs, not the full codebase. Do not question imports,');
  sections.push('variable declarations, or patterns that may be defined elsewhere.');
  sections.push('');

  if (opts.agentSummary) {
    sections.push('The developer described their work as:');
    sections.push(`"${opts.agentSummary}"`);
    sections.push('');
  }

  sections.push('## Review Criteria');
  sections.push('');
  sections.push('Flag issues in these categories:');
  sections.push('1. **Bugs**: Logic errors, off-by-one errors, null/undefined issues, race conditions');
  sections.push('2. **Security**: Injection vulnerabilities, auth issues, data exposure, hardcoded secrets');
  sections.push('3. **Regressions**: Changes that might break existing functionality or API contracts');
  sections.push('4. **Dead code / Duplication**: New code that duplicates existing exports or functionality,');
  sections.push('   unreachable code paths, redundant operations that do nothing');
  sections.push('5. **Performance**: N+1 queries, unbounded loops, unnecessary allocations in hot paths');
  sections.push('6. **Needless complexity**: Reimplementing standard library functionality (e.g. hand-rolling');
  sections.push('   a loop to do what Math.min, Array.includes, or String.trim already does),');
  sections.push('   adding unnecessary intermediate conversions, or making code harder to understand');
  sections.push('   with no behavioral benefit');
  sections.push('');
  sections.push('Only flag issues where you are >80% confident they are real problems.');
  sections.push('');
  sections.push('## Do NOT flag');
  sections.push('');
  sections.push('- Style preferences, formatting, or naming opinions');
  sections.push('- Missing comments, documentation, or type annotations');
  sections.push('- Subjective refactoring suggestions (e.g. "this could be cleaner")');
  sections.push('- Anything that is purely a matter of taste');
  sections.push('');
  sections.push('## Output Format');
  sections.push('');
  sections.push('For each finding, output exactly this format:');
  sections.push('[severity] file:line - description');
  sections.push('');
  sections.push('Where severity is one of: error, warning');
  sections.push('Use error for bugs, security issues, and regressions.');
  sections.push('Use warning for duplication, dead code, and performance concerns.');
  sections.push('');
  sections.push('If no issues found, output exactly: No issues found');
  sections.push('');

  if (opts.codebaseContext) {
    sections.push('## Codebase Context');
    sections.push(opts.codebaseContext);
    sections.push('');
  }

  sections.push('## Diffs to Review');
  sections.push('');
  for (const [file, diff] of opts.diffs) {
    sections.push(`### ${file}`);
    sections.push('```diff');
    sections.push(diff);
    sections.push('```');
    sections.push('');
  }

  return sections.join('\n');
}

const FINDING_REGEX = /^\[(\w+)\]\s+(\S+?)(?::(\d+))?\s+-\s+(.+)/;

function parseFindings(output: string): Finding[] {
  const normalized = output.trim().toLowerCase();
  if (normalized === 'no issues found' || normalized === 'no issues found.') {
    return [];
  }

  const findings: Finding[] = [];
  const seen = new Set<string>();

  for (const line of output.split('\n')) {
    const match = line.match(FINDING_REGEX);
    if (!match) continue;

    const [, severity, file, lineStr, message] = match;
    if (!severity || !file || !message) continue;
    if (severity !== 'error' && severity !== 'warning') continue;

    const lineNum = lineStr ? Number.parseInt(lineStr, 10) : null;
    const key = `${file}::${lineNum}::${message}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      file,
      line: lineNum,
      message: message.trim(),
      severity: severity as 'error' | 'warning',
    });
  }

  return findings;
}
