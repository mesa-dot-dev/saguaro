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
      description: 'Run a code review against defined rules. Returns violations found in the current changes.',
      inputSchema: {
        base_branch: z.string().default('main').describe('Branch to diff against'),
        head_branch: z.string().default('HEAD').describe('Branch or ref to review (defaults to HEAD)'),
      },
    },
    (args) => handleToolCall('mesa_review', args)
  );

  server.registerTool(
    'mesa_list_rules',
    {
      description: 'List all available review rules with their IDs, titles, and severity levels.',
      inputSchema: {
        tags: z.array(z.string()).optional().describe('Optional tag filter'),
      },
    },
    (args) => handleToolCall('mesa_list_rules', args)
  );

  server.registerTool(
    'mesa_explain_rule',
    {
      description: 'Get detailed information about a specific review rule including instructions, globs, and examples.',
      inputSchema: {
        rule_id: z.string().describe('The rule ID to look up'),
      },
    },
    (args) => handleToolCall('mesa_explain_rule', args)
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
        scope: z.string().optional().describe('Optional scope path (e.g., "packages/web") for collocated placement'),
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
