#!/usr/bin/env node
import { cli } from './commands/index.js';

const handled = await cli(process.argv.slice(2));
if (!handled) {
  // No CLI command matched — launch TUI
  const { launchTui } = await import('../tui/index.js');
  await launchTui();
}
