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

const HOMEBREW_BIN_PREFIXES = ['/opt/homebrew/bin/', '/usr/local/bin/'];

function isHomebrewInstall(): boolean {
  const script = process.argv[1] ?? '';
  return HOMEBREW_BIN_PREFIXES.some((prefix) => script.startsWith(prefix));
}

export function getMcpJsonConfig(): McpJsonConfig {
  const homebrew = isHomebrewInstall();
  const command = homebrew ? 'mesa' : 'node';
  const args = homebrew ? ['serve'] : [process.argv[1], 'serve'];

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
