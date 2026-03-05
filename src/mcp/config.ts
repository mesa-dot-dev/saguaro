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
    // In compiled Bun binaries, both argv[0] ("bun") and argv[1] ("/$bunfs/...")
    // are useless for determining the real binary path. The binary is always
    // invocable as "mesa" (installed via Homebrew or on PATH).
    return {
      mcpServers: {
        mesa: { type: 'stdio', command: 'mesa', args: ['serve'] },
      },
    };
  }

  // Dev mode: node/bun running the script directly.
  const scriptPath = process.argv[1] ?? '';
  const homebrew = isHomebrewPath(scriptPath);
  const command = homebrew ? 'mesa' : 'bun';
  const args = homebrew ? ['serve'] : [scriptPath, 'serve'];

  return {
    mcpServers: {
      mesa: { type: 'stdio', command, args },
    },
  };
}
