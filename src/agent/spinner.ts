import * as readline from 'node:readline';

export function createProcessingSpinner(enabled: boolean, initialMessage: string) {
  const frames = ['-', '\\', '|', '/'];
  let frameIndex = 0;
  let message = initialMessage;
  let timer: NodeJS.Timeout | null = null;

  const render = () => {
    if (!enabled) return;
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(`${frames[frameIndex]} ${message}`);
    frameIndex = (frameIndex + 1) % frames.length;
  };

  const start = () => {
    if (!enabled || timer) return;
    render();
    timer = setInterval(render, 120);
  };

  const stop = () => {
    if (!enabled) return;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
  };

  return {
    start,
    stop,
    setMessage(nextMessage: string) {
      message = nextMessage;
    },
    log(line: string) {
      stop();
      console.log(line);
      start();
    },
    error(line: string) {
      stop();
      console.error(line);
      start();
    },
  };
}
