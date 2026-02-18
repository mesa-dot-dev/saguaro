import chalk from 'chalk';

const accent = chalk.hex('#be3c00');

export class CliSpinner {
  private readonly frames = ['-', '\\', '|', '/'];
  private interval: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;
  private isRunning = false;
  private text = '';

  start(text: string): void {
    // Clear any existing interval to prevent leaks when start() is called
    // multiple times without an intervening stop().
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.text = text;
    this.isRunning = true;

    if (!process.stdout.isTTY) return;

    this.render();
    this.interval = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, 80);
  }

  update(text: string): void {
    this.text = text;
    if (this.isRunning && process.stdout.isTTY) this.render();
  }

  log(message: string): void {
    if (this.isRunning && process.stdout.isTTY) {
      this.clearLine();
      console.log(message);
      this.render();
      return;
    }
    console.log(message);
  }

  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (process.stdout.isTTY) this.clearLine();
  }

  private render(): void {
    const frame = this.frames[this.frameIndex];
    process.stdout.write(`\r\x1b[2K${accent(frame)} ${this.text}`);
  }

  private clearLine(): void {
    process.stdout.write('\r\x1b[2K');
  }
}
