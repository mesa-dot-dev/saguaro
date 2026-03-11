import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logger } from '../util/logger.js';
import { migrateMesaToSaguaro } from '../util/migrate.js';
import { handleToolCall } from './tools/handler.js';

export function createSaguaroMcpServer(): McpServer {
  const server = new McpServer({ name: 'saguaro', version: '0.1.0' });

  server.registerTool(
    'saguaro_review',
    {
      description:
        'Run a code review on current changes. Supports three modes: rules-based review against defined rules, Saguaro classic review (staff-engineer quality check), or both combined. Only call this tool when the user explicitly asks for a review. Do NOT call it proactively before or after making edits — the review hook handles that automatically.',
      inputSchema: {
        base_branch: z.string().default('main').describe('Branch to diff against'),
        head_branch: z.string().default('HEAD').describe('Branch or ref to review (defaults to HEAD)'),
        mode: z
          .enum(['rules', 'classic', 'full'])
          .default('rules')
          .describe(
            'Review mode: "rules" for rules-based review, "classic" for agentic staff-engineer review, "full" for both'
          ),
      },
    },
    (args) => handleToolCall('saguaro_review', args)
  );

  server.registerTool(
    'saguaro_create_rule',
    {
      description: 'Create a new review rule. Provide a title, severity, file glob patterns, and instructions.',
      inputSchema: {
        title: z.string().describe('Human-readable rule title'),
        severity: z.enum(['error', 'warning', 'info']).describe('Rule severity level'),
        globs: z.array(z.string()).describe('File glob patterns this rule applies to'),
        instructions: z.string().describe('Detailed instructions for what the rule checks (markdown)'),
        id: z.string().optional().describe('Optional custom rule ID (auto-generated from title if omitted)'),
        examples: z
          .object({
            violations: z.array(z.string()).optional().describe('Example code that violates this rule'),
            compliant: z.array(z.string()).optional().describe('Example code that follows this rule'),
          })
          .optional()
          .describe('Optional example code snippets'),
      },
    },
    (args) => handleToolCall('saguaro_create_rule', args)
  );

  server.registerTool(
    'saguaro_delete_rule',
    {
      description: 'Delete a review rule by its ID.',
      inputSchema: {
        rule_id: z.string().describe('The rule ID to delete'),
      },
    },
    (args) => handleToolCall('saguaro_delete_rule', args)
  );

  server.registerTool(
    'saguaro_validate_rules',
    {
      description: 'Validate all review rule files for correct structure and report any errors.',
    },
    () => handleToolCall('saguaro_validate_rules', {})
  );

  server.registerTool(
    'saguaro_generate_rules',
    {
      description:
        'Run the full rule generation pipeline (codebase scanning, import graph indexing, LLM analysis, synthesis). Returns compact rule summaries (id, title, severity, globs) without writing them. Full rule details (instructions, examples) are held in session — use saguaro_get_generated_rule_details to fetch them. Use saguaro_write_accepted_rules to persist accepted rules.',
    },
    () => handleToolCall('saguaro_generate_rules', {})
  );

  server.registerTool(
    'saguaro_get_generated_rule_details',
    {
      description:
        'Fetch full details (instructions, examples, tags) for generated rules. Call with no arguments to get the next batch of 10 rules. Optionally pass rule_ids to fetch specific rules by ID.',
      inputSchema: {
        rule_ids: z
          .array(z.string())
          .optional()
          .describe('Optional array of rule IDs for targeted lookup. Omit to get next batch.'),
      },
    },
    (args) => handleToolCall('saguaro_get_generated_rule_details', args)
  );

  server.registerTool(
    'saguaro_write_accepted_rules',
    {
      description:
        'Write previously generated rules to disk. Takes an array of rule IDs from the most recent saguaro_generate_rules result. Each rule is written using the same deterministic pipeline as the CLI (scope computed from globs, skill files created). Must be called after saguaro_generate_rules.',
      inputSchema: {
        rule_ids: z
          .array(z.string())
          .describe('Array of rule IDs to accept and write (from saguaro_generate_rules output)'),
      },
    },
    (args) => handleToolCall('saguaro_write_accepted_rules', args)
  );

  server.registerTool(
    'saguaro_generate_rule',
    {
      description:
        'Generate a single review rule for a target directory. Analyzes the code, generates a rule via LLM, and returns the proposal with a preview of which files would be flagged. Use saguaro_create_rule to persist the accepted rule.',
      inputSchema: {
        target: z.string().describe('Target directory path relative to repo root (e.g., "src/cli", "packages/web")'),
        intent: z.string().describe('What convention or pattern the rule should enforce'),
        title: z.string().optional().describe('Optional rule title (inferred from intent if omitted)'),
        severity: z
          .enum(['error', 'warning', 'info'])
          .optional()
          .describe('Optional severity level (inferred if omitted)'),
      },
    },
    (args) => handleToolCall('saguaro_generate_rule', args)
  );

  server.registerTool(
    'saguaro_get_models',
    {
      description: 'Get available AI models for code review, grouped by provider. Returns current model if configured.',
      inputSchema: {
        provider: z
          .enum(['anthropic', 'openai', 'google'])
          .optional()
          .describe('Filter to a specific provider. Omit to get all providers.'),
      },
    },
    (args) => handleToolCall('saguaro_get_models', args)
  );

  server.registerTool(
    'saguaro_set_model',
    {
      description:
        'Set the AI model used for code reviews. Updates .saguaro/config.yaml. Optionally saves API key to .env.local.',
      inputSchema: {
        provider: z.enum(['anthropic', 'openai', 'google']).describe('AI provider'),
        model: z.string().describe('Model identifier (e.g. claude-opus-4-6, gpt-5.2-codex)'),
        api_key: z.string().optional().describe('API key for the provider (saved to .env.local if provided)'),
      },
    },
    (args) => handleToolCall('saguaro_set_model', args)
  );

  return server;
}

export async function startMcpServer(options: { transport: 'stdio' }): Promise<void> {
  migrateMesaToSaguaro();

  // Silence logger — stdout is the MCP protocol channel, console.log would corrupt it
  logger.setLevel('silent');

  const server = createSaguaroMcpServer();

  if (options.transport === 'stdio') {
    const transport = new StdioServerTransport();
    console.error('[saguaro-mcp] starting stdio transport, cwd:', process.cwd());
    await server.connect(transport);
    console.error('[saguaro-mcp] server connected');
  }
}
