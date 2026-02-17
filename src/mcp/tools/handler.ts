import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { runReview } from '../../adapter/review.js';
import {
  createSkillAdapter,
  deleteSkillAdapter,
  explainSkillAdapter,
  listSkillsAdapter,
  validateSkillsAdapter,
} from '../../adapter/skills.js';
import type { Severity } from '../../types/types.js';

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
  const { skills } = listSkillsAdapter({});
  const tags = args.tags as string[] | undefined;

  const mapped = skills.map((s) => ({
    id: s.id,
    title: s.title,
    severity: s.severity,
    tags: s.tags ?? [],
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

  const { skill } = explainSkillAdapter({ skillId: ruleId });
  if (!skill) {
    return errorResult(`Rule not found: ${ruleId}`);
  }

  return jsonResult({
    id: skill.id,
    title: skill.title,
    severity: skill.severity,
    globs: skill.globs,
    instructions: skill.instructions,
    tags: skill.tags ?? [],
    examples: skill.examples,
  });
}

function handleValidateRules(): CallToolResult {
  debug('mesa_validate_rules called');
  const { validated, errors } = validateSkillsAdapter({});
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
  const scope = args.scope as string | undefined;
  const examples = args.examples as { violations?: string[]; compliant?: string[] } | undefined;

  if (!title || !severity || !globs || !instructions) {
    return errorResult('title, severity, globs, and instructions are required');
  }

  const result = createSkillAdapter({
    title,
    severity,
    globs,
    instructions,
    id,
    scope,
    examples,
  });

  debug('mesa_create_rule created', { id: result.skill.id, path: result.skillDir });
  return jsonResult({
    id: result.skill.id,
    title: result.skill.title,
    path: result.skillDir,
  });
}

function handleDeleteRule(args: Record<string, unknown>): CallToolResult {
  debug('mesa_delete_rule called', args);
  const ruleId = args.rule_id as string;
  if (!ruleId) {
    return errorResult('rule_id is required');
  }

  const { deleted } = deleteSkillAdapter({ skillId: ruleId });
  if (!deleted) {
    return errorResult(`Rule not found: ${ruleId}`);
  }

  return jsonResult({ deleted: true, id: ruleId });
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
