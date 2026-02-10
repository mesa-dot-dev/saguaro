export type LogLevel = 'silent' | 'normal' | 'verbose' | 'debug';

let currentLevel: LogLevel = 'normal';

export const logger = {
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  getLevel(): LogLevel {
    return currentLevel;
  },

  /** Always shown — errors, fatal messages */
  error(...args: unknown[]): void {
    console.error(...args);
  },

  /** Normal output — progress, summaries, results */
  info(...args: unknown[]): void {
    if (currentLevel !== 'silent') {
      console.log(...args);
    }
  },

  /** --verbose — timing, token counts, file lists */
  verbose(...args: unknown[]): void {
    if (currentLevel === 'verbose' || currentLevel === 'debug') {
      console.log(...args);
    }
  },

  /** --debug — prompts, raw LLM responses, full config */
  debug(...args: unknown[]): void {
    if (currentLevel === 'debug') {
      console.log(...args);
    }
  },
};
