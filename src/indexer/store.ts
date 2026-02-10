import fs from 'node:fs';
import path from 'node:path';
import type { CodebaseIndex, FileEntry } from './types.js';

export const CURRENT_VERSION = 1;

type BlastLabel = 'changed' | 'importer' | 'dependency';

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

  getDependencies(filePath: string): string[] {
    const entry = this.getFile(filePath);
    if (!entry) return [];
    return entry.imports.map((imp) => imp.resolvedPath).filter((p): p is string => p !== null);
  }

  getBlastRadius(roots: string[], maxDepth: number): Map<string, BlastLabel> {
    const result = new Map<string, BlastLabel>();

    // Seed all roots as 'changed'
    for (const root of roots) {
      result.set(root, 'changed');
    }

    // BFS frontier: each item is [filePath, currentDepth]
    let frontier: Array<[string, number]> = roots.map((r) => [r, 0]);

    while (frontier.length > 0) {
      const nextFrontier: Array<[string, number]> = [];

      for (const [filePath, depth] of frontier) {
        if (depth >= maxDepth) continue;

        // Traverse importedBy edges (files that import this file)
        const importers = this.getImporters(filePath);
        for (const importer of importers) {
          if (!result.has(importer)) {
            result.set(importer, 'importer');
            nextFrontier.push([importer, depth + 1]);
          }
        }

        // Traverse import edges (files this file depends on)
        const dependencies = this.getDependencies(filePath);
        for (const dep of dependencies) {
          if (!result.has(dep)) {
            result.set(dep, 'dependency');
            nextFrontier.push([dep, depth + 1]);
          }
        }
      }

      frontier = nextFrontier;
    }

    return result;
  }
}
