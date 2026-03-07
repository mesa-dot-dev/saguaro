import { isMesaOnPath, resolveDistBin } from '../util/resolve-bin.js';

export interface McpServerEntry {
  type: 'stdio';
  command: string;
  args: string[];
}

export interface McpJsonConfig {
  mcpServers: {
    mesa: McpServerEntry;
  };
}

function isCompiledBinary(): boolean {
  return (process.argv[1] ?? '').startsWith('/$bunfs/');
}

/**
 * Generate the MCP server configuration for .mcp.json.
 *
 * Resolution order:
 * 1. Compiled Bun binary or mesa on PATH -> { command: "mesa", args: ["serve"] }
 * 2. Dev mode / npm local -> { command: "node", args: ["<bin.js>", "serve"] }
 */
export function getMcpJsonConfig(): McpJsonConfig {
  if (isCompiledBinary() || isMesaOnPath()) {
    return {
      mcpServers: {
        mesa: { type: 'stdio', command: 'mesa', args: ['serve'] },
      },
    };
  }

  // Dev mode / npm local install: resolve bin.js relative to this file.
  const distBin = resolveDistBin(import.meta.url);

  return {
    mcpServers: {
      mesa: { type: 'stdio', command: 'node', args: [distBin, 'serve'] },
    },
  };
}
