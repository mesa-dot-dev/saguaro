import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './app.js';
import { setExitHandler } from './lib/exit.js';

export async function launchTui() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 60,
  });

  setExitHandler(() => {
    renderer.destroy();
  });

  const root = createRoot(renderer);
  root.render(<App />);

  // Keep process alive — TUI handles its own exit via Ctrl+C
  await new Promise<void>(() => {});
}
