import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { runReview } from '../../adapter/review.js';
import {
  createRuleAdapter,
  deleteRuleAdapter,
  explainRuleAdapter,
  generateRuleAdapter,
  listRulesAdapter,
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

function handleListRules(args: Record<string, unknown>): CallToolResult {
  debug('mesa_list_rules called', args);
  const { rules } = listRulesAdapter();
  const tags = args.tags as string[] | undefined;

  const mapped = rules.map((rule) => ({
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    tags: rule.tags ?? [],
  }));

  const filtered = tags?.length ? mapped.filter((r) => r.tags.some((t) => tags.includes(t))) : mapped;

  debug(`mesa_list_rules returning ${filtered.length} rules`);
  return jsonResult(filtered);
}

function handleExplainRule(args: Record<string, unknown>): CallToolResult {
  debug('mesa_explain_rule called', args);
  const ruleId = args.rule_id as string;
  if (!ruleId) {
    return errorResult('rule_id is required');
  }

  const { rule } = explainRuleAdapter({ ruleId });
  if (!rule) {
    return errorResult(`Rule not found: ${ruleId}`);
  }

  return jsonResult({
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    globs: rule.globs,
    instructions: rule.instructions,
    tags: rule.tags ?? [],
    examples: rule.examples,
  });
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
  debug(`mesa_sync_rules: synced=${result.synced}, removed=${result.removed.length}`);
  return jsonResult({
    synced: result.synced,
    removed: result.removed.length,
    errors: result.errors,
  });
}

async function handleGenerateRules(): Promise<CallToolResult> {
  debug('mesa_generate_rules called');
  const result = await generateRules({ cwd: process.cwd() });
  lastGeneratedRules = result.rules;
  debug(`mesa_generate_rules returning ${result.rules.length} rules (stored in session state)`);
  return jsonResult({
    rules: result.rules,
    summary: {
      filesScanned: result.summary.filesScanned,
      rulesGenerated: result.summary.rulesGenerated,
      durationMs: result.summary.durationMs,
    },
  });
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

export async function handleToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  debug(`handleToolCall: ${name}`);
  switch (name) {
    case 'mesa_list_rules':
      return handleListRules(args);
    case 'mesa_explain_rule':
      return handleExplainRule(args);
    case 'mesa_validate_rules':
      return handleValidateRules();
    case 'mesa_create_rule':
      return handleCreateRule(args);
    case 'mesa_delete_rule':
      return handleDeleteRule(args);
    case 'mesa_sync_rules':
      return handleSyncRules();
    case 'mesa_generate_rules':
      try {
        return await handleGenerateRules();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debug('mesa_generate_rules EXCEPTION', { error: message, stack: err instanceof Error ? err.stack : undefined });
        return errorResult(`Rule generation failed: ${message}`);
      }
    case 'mesa_generate_rule':
      try {
        return await handleGenerateRule(args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debug('mesa_generate_rule EXCEPTION', { error: message, stack: err instanceof Error ? err.stack : undefined });
        return errorResult(`Rule generation failed: ${message}`);
      }
    case 'mesa_write_accepted_rules':
      return handleWriteAcceptedRules(args);
    case 'mesa_review':
      try {
        return await handleReview(args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        debug('mesa_review EXCEPTION', { error: message, stack: err instanceof Error ? err.stack : undefined });
        return errorResult(`Review failed: ${message}`);
      }
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}
