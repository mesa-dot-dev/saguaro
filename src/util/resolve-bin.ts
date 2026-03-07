import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Check whether `mesa` is available on the system PATH.
 */
export function isMesaOnPath(): boolean {
  try {
    execFileSync('which', ['mesa'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the absolute path to `dist/cli/bin.js` relative to the calling
 * module's location. Pass `import.meta.url` from the call site so the
 * resolution is anchored correctly.
 */
export function resolveDistBin(callerMetaUrl: string): string {
  const callerDir = path.dirname(fileURLToPath(callerMetaUrl));
  // Walk up to dist/ then into cli/bin.js.
  // Works because all call sites live at dist/<module>/... or dist/<module>/<sub>/...
  // and the target is always dist/cli/bin.js.
  let dir = callerDir;
  while (path.basename(dir) !== 'dist' && dir !== path.dirname(dir)) {
    dir = path.dirname(dir);
  }
  if (path.basename(dir) !== 'dist') {
    throw new Error(`resolveDistBin: could not find 'dist' ancestor from ${callerDir}`);
  }
  return path.join(dir, 'cli', 'bin.js');
}
