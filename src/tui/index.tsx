import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';

function App() {
  return (
    <box flexDirection="column" alignItems="center" justifyContent="center">
      <text fg="#fab283">Mesa</text>
      <text fg="#808080">Press Ctrl+C to exit</text>
    </box>
  );
}

export async function launchTui() {
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const root = createRoot(renderer);
  root.render(<App />);

  // Keep process alive — TUI handles its own exit via Ctrl+C
  await new Promise<void>(() => {});
}
