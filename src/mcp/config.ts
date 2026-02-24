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

function isCompiledBinary(): boolean {
  return (process.argv[1] ?? '').startsWith('/$bunfs/');
}

function isHomebrewPath(filePath: string): boolean {
  return HOMEBREW_BIN_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

export function getMcpJsonConfig(): McpJsonConfig {
  if (isCompiledBinary()) {
    // In compiled Bun binaries, argv[0] is the real binary path and
    // argv[1] is the internal /$bunfs/ entry point (unusable on disk).
    const binaryPath = process.argv[0] ?? 'mesa';
    const command = isHomebrewPath(binaryPath) ? 'mesa' : binaryPath;
    return {
      mcpServers: {
        mesa: { type: 'stdio', command, args: ['serve'] },
      },
    };
  }

  // Dev mode: node/bun running the script directly.
  const scriptPath = process.argv[1] ?? '';
  const homebrew = isHomebrewPath(scriptPath);
  const command = homebrew ? 'mesa' : 'node';
  const args = homebrew ? ['serve'] : [scriptPath, 'serve'];

  return {
    mcpServers: {
      mesa: { type: 'stdio', command, args },
    },
  };
}
