#!/usr/bin/env node
import { cli } from './commands/index.js';

const isBun = typeof (globalThis as Record<string, unknown>).Bun !== 'undefined';

const handled = await cli(process.argv.slice(2));
if (!handled) {
  if (!isBun) {
    // The TUI depends on @opentui which requires the Bun runtime.
    // Try re-exec under Bun, or show install message.
    const { spawnSync } = await import('node:child_process');
    const check = spawnSync('bun', ['--version'], { stdio: 'ignore' });
    if (check.status === 0) {
      const result = spawnSync('bun', [import.meta.filename, ...process.argv.slice(2)], { stdio: 'inherit' });
      process.exit(result.status ?? 1);
    } else {
      console.log('Install Bun for TUI support: curl -fsSL https://bun.sh/install | bash');
      process.exit(0);
    }
  } else {
    const { launchTui } = await import('../tui/index.js');
    await launchTui();
  }
}
