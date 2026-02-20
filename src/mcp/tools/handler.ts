import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { runReview } from '../../adapter/review.js';
import {
  createRuleAdapter,
  deleteRuleAdapter,
  generateRuleAdapter,
  validateRulesAdapter,
  writeGeneratedRules,
} from '../../adapter/rules.js';
import { generateRules } from '../../generator/index.js';
import { findRepoRoot } from '../../lib/rule-resolution.js';
import { syncSkillsFromRules } from '../../lib/skill-sync.js';
import type { RulePolicy, Severity } from '../../types/types.js';

// ---------------------------------------------------------------------------
// State: last generated rules (survives across tool calls within a session)
// ---------------------------------------------------------------------------
let lastGeneratedRules: RulePolicy[] = [];

const LOG_FILE = path.join(os.tmpdir(), 'mesa-mcp-debug.log');

/** Debug log to file + stderr — stdout is MCP protocol, never touch it */
function debug(msg: string, data?: unknown): void {
  const ts = new Date().toISOString();
  const line = data !== undefined ? `[${ts}] ${msg} ${JSON.stringify(data)}` : `[${ts}] ${msg}`;
  console.error(line);
  fs.appendFileSync(LOG_FILE, `${line}\n`);
}

function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): CallToolResult {
  debug('ERROR:', message);
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function handleValidateRules(): CallToolResult {
  debug('mesa_validate_rules called');
  const { validated, errors } = validateRulesAdapter();
  debug(`mesa_validate_rules: ${validated.length} validated, ${errors.length} errors`);
  return jsonResult({
    valid: errors.length === 0,
    validated,
    errors,
  });
}

function handleCreateRule(args: Record<string, unknown>): CallToolResult {
  debug('mesa_create_rule called', args);
  const title = args.title as string;
  const severity = args.severity as Severity;
  const globs = args.globs as string[];
  const instructions = args.instructions as string;
  const id = args.id as string | undefined;
  const examples = args.examples as { violations?: string[]; compliant?: string[] } | undefined;

  if (!title || !severity || !globs || !instructions) {
    return errorResult('title, severity, globs, and instructions are required');
  }

  const result = createRuleAdapter({
    title,
    severity,
    globs,
    instructions,
    id,
    examples,
  });

  debug('mesa_create_rule created', { id: result.rule.id, path: result.policyFilePath });
  return jsonResult({
    id: result.rule.id,
    title: result.rule.title,
    path: result.policyFilePath,
  });
}

function handleDeleteRule(args: Record<string, unknown>): CallToolResult {
  debug('mesa_delete_rule called', args);
  const ruleId = args.rule_id as string;
  if (!ruleId) {
    return errorResult('rule_id is required');
  }

  const { deleted } = deleteRuleAdapter({ ruleId });
  if (!deleted) {
    return errorResult(`Rule not found: ${ruleId}`);
  }

  return jsonResult({ deleted: true, id: ruleId });
}

function handleSyncRules(): CallToolResult {
  debug('mesa_sync_rules called');
  const repoRoot = findRepoRoot();
  const result = syncSkillsFromRules(repoRoot);
  debug(`mesa_sync_rules: synced=${result.synced}`);
  return jsonResult({
    synced: result.synced,
    errors: result.errors,
  });
}

async function handleGenerateRules(): Promise<CallToolResult> {
  debug('mesa_generate_rules called');
  const result = await generateRules({ cwd: process.cwd() });
  lastGeneratedRules = result.rules;
  debug(`mesa_generate_rules returning ${result.rules.length} rules (stored in session state)`);
  return jsonResult({
    rules: result.rules.map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      globs: r.globs,
    })),
    summary: {
      filesScanned: result.summary.filesScanned,
      rulesGenerated: result.summary.rulesGenerated,
      durationMs: result.summary.durationMs,
    },
  });
}

function handleGetGeneratedRuleDetails(args: Record<string, unknown>): CallToolResult {
  debug('mesa_get_generated_rule_details called', args);
  const ruleIds = args.rule_ids as string[];

  if (!ruleIds || !Array.isArray(ruleIds) || ruleIds.length === 0) {
    return errorResult('rule_ids is required and must be a non-empty array of rule ID strings');
  }

  if (lastGeneratedRules.length === 0) {
    return errorResult('No generated rules in session. Run mesa_generate_rules first.');
  }

  const requestedSet = new Set(ruleIds);
  const found = lastGeneratedRules.filter((r) => requestedSet.has(r.id));
  const notFound = ruleIds.filter((id) => !lastGeneratedRules.some((r) => r.id === id));

  debug(`mesa_get_generated_rule_details: ${found.length} found, ${notFound.length} not found`);
  return jsonResult({ rules: found, notFound });
}

async function handleGenerateRule(args: Record<string, unknown>): Promise<CallToolResult> {
  debug('mesa_generate_rule called', args);
  const target = args.target as string;
  const intent = args.intent as string;

  if (!target || !intent) {
    return errorResult('target and intent are required');
  }

  const title = args.title as string | undefined;
  const severity = args.severity as 'error' | 'warning' | 'info' | undefined;

  const result = await generateRuleAdapter({ target, intent, title, severity });
  debug('mesa_generate_rule returning', { ruleId: result.rule.id });
  return jsonResult(result);
}

function handleWriteAcceptedRules(args: Record<string, unknown>): CallToolResult {
  debug('mesa_write_accepted_rules called', args);
  const ruleIds = args.rule_ids as string[];

  if (!ruleIds || !Array.isArray(ruleIds) || ruleIds.length === 0) {
    return errorResult('rule_ids is required and must be a non-empty array of rule ID strings');
  }

  if (lastGeneratedRules.length === 0) {
    return errorResult('No generated rules in session. Run mesa_generate_rules first.');
  }

  const acceptedSet = new Set(ruleIds);
  const accepted = lastGeneratedRules.filter((r) => acceptedSet.has(r.id));
  const skippedIds = ruleIds.filter((id) => !lastGeneratedRules.some((r) => r.id === id));

  const result = writeGeneratedRules(accepted);

  debug('mesa_write_accepted_rules done', {
    written: result.written.length,
    skipped: skippedIds.length,
  });

  return jsonResult({ ...result, skippedIds });
}

async function handleReview(args: Record<string, unknown>): Promise<CallToolResult> {
  const baseRef = (args.base_branch as string) ?? 'main';
  const headRef = (args.head_branch as string) ?? 'HEAD';

  const configExists = fs.existsSync(path.resolve(process.cwd(), '.mesa', 'config.yaml'));
  debug('mesa_review called', { baseRef, headRef, cwd: process.cwd(), configExists });

  const startMs = Date.now();
  const { outcome } = await runReview({
    baseRef,
    headRef,
    verbose: true,
    onProgress: (event) => {
      debug('review-progress', event);
    },
    source: 'mcp',
  });
  const durationMs = Date.now() - startMs;

  debug(`mesa_review completed in ${durationMs}ms, outcome: ${outcome.kind}`);

  switch (outcome.kind) {
    case 'no-changed-files':
      return jsonResult({
        status: 'no-changed-files',
        message: 'No changed files detected between the base and head refs.',
      });
    case 'no-matching-skills':
      debug('no-matching-skills', { changedFiles: outcome.changedFiles });
      return jsonResult({
        status: 'no-matching-skills',
        message: `Found ${outcome.changedFiles.length} changed file(s) but no rules matched.`,
        changedFiles: outcome.changedFiles,
      });
    case 'reviewed':
      debug('reviewed', {
        filesReviewed: outcome.result.summary.filesReviewed,
        rulesChecked: outcome.result.summary.rulesChecked,
        violations: outcome.result.violations.length,
        errors: outcome.result.summary.errors,
        warnings: outcome.result.summary.warnings,
        outputTokens: outcome.result.summary.outputTokens,
      });
      return jsonResult({
        status: 'reviewed',
        summary: outcome.result.summary,
        violations: outcome.result.violations,
      });
  }
}

function measureResult(result: CallToolResult): { chars: number; contentBlocks: number } {
  let chars = 0;
  const content = result.content as { type: string; text?: string }[];
  for (const block of content) {
    if (block.text) chars += block.text.length;
  }
  return { chars, contentBlocks: content.length };
}

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  debug(`handleToolCall: ${name}`);
  let result: CallToolResult;
  switch (name) {
    case 'mesa_validate_rules':
      result = handleValidateRules();
      break;
    case 'mesa_create_rule':
      result = handleCreateRule(args);
      break;
    case 'mesa_delete_rule':
      result = handleDeleteRule(args);
      break;
    case 'mesa_sync_rules':
      result = handleSyncRules();
      break;
    case 'mesa_generate_rules':
      try {
        result = await handleGenerateRules();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debug('mesa_generate_rules EXCEPTION', { error: message, stack: err instanceof Error ? err.stack : undefined });
        result = errorResult(`Rule generation failed: ${message}`);
      }
      break;
    case 'mesa_generate_rule':
      try {
        result = await handleGenerateRule(args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debug('mesa_generate_rule EXCEPTION', { error: message, stack: err instanceof Error ? err.stack : undefined });
        result = errorResult(`Rule generation failed: ${message}`);
      }
      break;
    case 'mesa_get_generated_rule_details':
      result = handleGetGeneratedRuleDetails(args);
      break;
    case 'mesa_write_accepted_rules':
      result = handleWriteAcceptedRules(args);
      break;
    case 'mesa_review':
      try {
        result = await handleReview(args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debug('mesa_review EXCEPTION', { error: message, stack: err instanceof Error ? err.stack : undefined });
        result = errorResult(`Review failed: ${message}`);
      }
      break;
    default:
      result = errorResult(`Unknown tool: ${name}`);
  }

  const { chars, contentBlocks } = measureResult(result);
  debug(`handleToolCall complete: ${name}`, { chars, contentBlocks, isError: result.isError ?? false });
  return result;
}
