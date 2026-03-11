import { loadValidatedConfig } from '../config/model-config.js';
import { getDiffsForFiles } from '../git/git.js';
import type { AgentName } from './agent-cli.js';
import { invokeAgent } from './agent-cli.js';
import { buildStaffEngineerPrompt, parseFindings, stripDiffContext } from './prompt.js';
import type { ChangedFile, DaemonStore } from './store.js';

export interface WorkerConfig {
  agent: AgentName;
  model?: string;
}

const MAX_PROMPT_CHARS = 125 * 1024;
const MAX_AGENT_SUMMARY_CHARS = 1000;

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

    const compactDiffs = new Map<string, string>();
    for (const [file, diff] of diffs) {
      compactDiffs.set(file, stripDiffContext(diff));
    }

    const agentSummary = job.agentSummary ? job.agentSummary.slice(0, MAX_AGENT_SUMMARY_CHARS) : null;

    // Load classic_prompt from config if available
    let customCriteria: string | undefined;
    try {
      const saguaroConfig = loadValidatedConfig();
      customCriteria = saguaroConfig.review.classic_prompt;
    } catch {
      // Config loading failure should not block daemon reviews
    }

    const prompt = buildStaffEngineerPrompt({ diffs: compactDiffs, agentSummary, customCriteria });

    if (prompt.length > MAX_PROMPT_CHARS) {
      console.warn(
        `[saguaro-daemon] Worker ${workerId} skipping job ${job.id}: prompt too large (${(prompt.length / 1024).toFixed(0)}KB > ${MAX_PROMPT_CHARS / 1024}KB)`
      );
      store.completeJob(job.id, 'done', config.model ?? config.agent);
      store.insertReview({ jobId: job.id, verdict: 'pass', findings: null });
      return true;
    }

    const output = await invokeAgent(config.agent, prompt, job.repoPath, config.model);
    const findings = parseFindings(output);
    const verdict = findings.length > 0 ? 'fail' : 'pass';

    store.completeJob(job.id, 'done', config.model ?? config.agent);
    store.insertReview({ jobId: job.id, verdict, findings: findings.length > 0 ? findings : null });
    return true;
  } catch (error) {
    console.error(`[saguaro-daemon] Worker ${workerId} failed job ${job.id}:`, error);
    store.completeJob(job.id, 'failed', config.model ?? config.agent);
    store.insertReview({ jobId: job.id, verdict: 'pass', findings: null });
    return true;
  }
}
