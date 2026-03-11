import path from 'node:path';
import { findRepoRoot } from '../git/git.js';
import { buildIndex } from '../indexer/build.js';
import { JsonIndexStore } from '../indexer/store.js';

export interface BuildIndexOptions {
  verbose?: boolean;
}

export interface BuildIndexResult {
  fileCount: number;
  durationMs: number;
  savedTo: string;
}

export async function runBuildIndex(options?: BuildIndexOptions): Promise<BuildIndexResult> {
  const rootDir = findRepoRoot();
  const saguaroCacheDir = path.join(rootDir, '.saguaro', 'cache');
  const store = new JsonIndexStore(saguaroCacheDir);

  const startTime = Date.now();

  const index = await buildIndex({
    rootDir,
    store,
    verbose: options?.verbose,
  });

  const fileCount = Object.keys(index.files).length;
  const durationMs = Date.now() - startTime;

  return {
    fileCount,
    durationMs,
    savedTo: '.saguaro/cache/index.json',
  };
}
