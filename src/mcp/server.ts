import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logger } from '../lib/logger.js';
import { handleToolCall } from './tools/handler.js';

export function createMesaMcpServer(): McpServer {
  const server = new McpServer({ name: 'mesa', version: '0.1.0' });

  server.registerTool(
    'mesa_review',
    {
      description:
        'Run a code review against defined rules. Returns violations found in the current changes. Only call this tool when the user explicitly asks for a review. Do NOT call it proactively before or after making edits — the review hook handles that automatically.',
      inputSchema: {
        base_branch: z.string().default('main').describe('Branch to diff against'),
        head_branch: z.string().default('HEAD').describe('Branch or ref to review (defaults to HEAD)'),
      },
    },
    (args) => handleToolCall('mesa_review', args)
  );

  server.registerTool(
    'mesa_create_rule',
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
    (args) => handleToolCall('mesa_create_rule', args)
  );

  server.registerTool(
    'mesa_delete_rule',
    {
      description: 'Delete a review rule by its ID.',
      inputSchema: {
        rule_id: z.string().describe('The rule ID to delete'),
      },
    },
    (args) => handleToolCall('mesa_delete_rule', args)
  );

  server.registerTool(
    'mesa_validate_rules',
    {
      description: 'Validate all review rule files for correct structure and report any errors.',
    },
    () => handleToolCall('mesa_validate_rules', {})
  );

  server.registerTool(
    'mesa_sync_rules',
    {
      description:
        'Regenerate .claude/skills/ from .mesa/rules/. Run after cloning a repo or when skills are out of sync.',
    },
    () => handleToolCall('mesa_sync_rules', {})
  );

  server.registerTool(
    'mesa_generate_rules',
    {
      description:
        'Run the full rule generation pipeline (codebase scanning, import graph indexing, LLM analysis, synthesis). Returns compact rule summaries (id, title, severity, globs) without writing them. Full rule details (instructions, examples) are held in session — use mesa_get_generated_rule_details to fetch them. Use mesa_write_accepted_rules to persist accepted rules.',
    },
    () => handleToolCall('mesa_generate_rules', {})
  );

  server.registerTool(
    'mesa_get_generated_rule_details',
    {
      description:
        'Fetch full details (instructions, examples, tags) for specific generated rules by ID. Reads from session state populated by the most recent mesa_generate_rules call. Use this to inspect rules before approving them.',
      inputSchema: {
        rule_ids: z
          .array(z.string())
          .describe('Array of rule IDs to fetch full details for (from mesa_generate_rules output)'),
      },
    },
    (args) => handleToolCall('mesa_get_generated_rule_details', args)
  );

  server.registerTool(
    'mesa_write_accepted_rules',
    {
      description:
        'Write previously generated rules to disk. Takes an array of rule IDs from the most recent mesa_generate_rules result. Each rule is written using the same deterministic pipeline as the CLI (scope computed from globs, skill files created). Must be called after mesa_generate_rules.',
      inputSchema: {
        rule_ids: z
          .array(z.string())
          .describe('Array of rule IDs to accept and write (from mesa_generate_rules output)'),
      },
    },
    (args) => handleToolCall('mesa_write_accepted_rules', args)
  );

  server.registerTool(
    'mesa_generate_rule',
    {
      description:
        'Generate a single review rule for a target directory. Analyzes the code, generates a rule via LLM, and returns the proposal with a preview of which files would be flagged. Use mesa_create_rule to persist the accepted rule.',
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
    (args) => handleToolCall('mesa_generate_rule', args)
  );

  return server;
}

export async function startMcpServer(options: { transport: 'stdio' }): Promise<void> {
  // Silence logger — stdout is the MCP protocol channel, console.log would corrupt it
  logger.setLevel('silent');

  const server = createMesaMcpServer();

  if (options.transport === 'stdio') {
    const transport = new StdioServerTransport();
    console.error('[mesa-mcp] starting stdio transport, cwd:', process.cwd());
    await server.connect(transport);
    console.error('[mesa-mcp] server connected');
  }
}
