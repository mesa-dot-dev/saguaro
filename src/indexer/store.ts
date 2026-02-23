import fs from 'node:fs';
import path from 'node:path';
import type { CodebaseIndex, FileEntry } from './types.js';

export const CURRENT_VERSION = 2;

type BlastLabel = 'changed' | 'importer';

const BARREL_FILENAMES = new Set([
  'index.ts',
  'index.js',
  'index.mjs',
  'index.cjs',
  'index.tsx',
  'index.jsx',
  'mod.rs',
  '__init__.py',
]);

function isBarrelFile(filePath: string, entry: FileEntry): boolean {
  const basename = path.basename(filePath);
  if (!BARREL_FILENAMES.has(basename)) return false;

  const totalExports = entry.exports.length;
  if (totalExports === 0) return false;

  const reExportCount = entry.exports.filter((e) => e.kind === 're-export' || e.kind === 're-export-all').length;
  return reExportCount / totalExports > 0.5;
}

export class JsonIndexStore {
  private readonly indexPath: string;
  private cached: CodebaseIndex | null = null;

  constructor(mesaCacheDir: string) {
    this.indexPath = path.join(mesaCacheDir, 'index.json');
  }

  load(): CodebaseIndex | null {
    if (this.cached) return this.cached;

    if (!fs.existsSync(this.indexPath)) return null;

    const raw = fs.readFileSync(this.indexPath, 'utf-8');
    const parsed = JSON.parse(raw) as CodebaseIndex;

    if (parsed.version !== CURRENT_VERSION) return null;

    this.cached = parsed;
    return this.cached;
  }

  save(index: CodebaseIndex): void {
    const dir = path.dirname(this.indexPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.indexPath, JSON.stringify(index), 'utf-8');
    this.cached = index;
  }

  getFile(filePath: string): FileEntry | null {
    const index = this.load();
    if (!index) return null;
    return index.files[filePath] ?? null;
  }

  getImporters(filePath: string): string[] {
    const entry = this.getFile(filePath);
    if (!entry) return [];
    return entry.importedBy;
  }

  getBlastRadius(roots: string[], maxDepth: number): Map<string, BlastLabel> {
    const result = new Map<string, BlastLabel>();

    for (const root of roots) {
      result.set(root, 'changed');
    }

    let frontier: Array<[string, number]> = roots.map((r) => [r, 0]);

    while (frontier.length > 0) {
      const nextFrontier: Array<[string, number]> = [];

      for (const [filePath, depth] of frontier) {
        if (depth >= maxDepth) continue;

        const importers = this.getImporters(filePath);
        for (const importer of importers) {
          if (result.has(importer)) continue;

          result.set(importer, 'importer');

          const importerEntry = this.getFile(importer);
          if (importerEntry && isBarrelFile(importer, importerEntry)) {
            // Barrel file: follow one extra level to catch real consumers,
            // but do NOT add barrel consumers to the BFS frontier.
            const barrelConsumers = this.getImporters(importer);
            for (const consumer of barrelConsumers) {
              if (!result.has(consumer)) {
                result.set(consumer, 'importer');
              }
            }
          }

          nextFrontier.push([importer, depth + 1]);
        }
      }

      frontier = nextFrontier;
    }

    return result;
  }
}
