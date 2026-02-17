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

function isLocalDevBuild(): boolean {
  const script = process.argv[1] ?? '';
  return script.includes('dist/cli/bin');
}

export function getMcpJsonConfig(): McpJsonConfig {
  const localDev = isLocalDevBuild();
  const command = localDev ? 'node' : 'mesa';
  const args = localDev ? [process.argv[1], 'serve'] : ['serve'];

  return {
    mcpServers: {
      mesa: {
        type: 'stdio',
        command,
        args,
      },
    },
  };
}
