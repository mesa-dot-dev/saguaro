import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isSupportedFile, parseFile } from './parsers/index.js';
import { createResolver } from './resolver.js';
import type { JsonIndexStore } from './store.js';
import type { CodebaseIndex, FileEntry } from './types.js';
import { SKIP_DIRS } from './types.js';

const MAX_FILE_SIZE = 1000000;

export interface BuildOptions {
  rootDir: string;
  store: JsonIndexStore;
  verbose?: boolean;
}

export async function buildIndex(options: BuildOptions): Promise<CodebaseIndex> {
  const { rootDir, store, verbose } = options;

  const existingIndex = store.load();
  const filePaths = discoverFiles(rootDir);

  if (verbose) {
    console.log(`Discovered ${filePaths.length} files to index`);
  }

  const resolver = createResolver(rootDir);
  const files: Record<string, FileEntry> = {};

  for (const relPath of filePaths) {
    const absPath = path.resolve(rootDir, relPath);
    const content = fs.readFileSync(absPath, 'utf8');
    const contentHash = hashContent(content);

    // Incremental: skip if unchanged
    const existing = existingIndex?.files[relPath];
    if (existing && existing.contentHash === contentHash) {
      files[relPath] = { ...existing, importedBy: [] }; // Reset importedBy, rebuilt below
      continue;
    }

    const parseResult = await parseFile(relPath, content);

    const resolvedImports = parseResult.imports.map((imp) => ({
      ...imp,
      resolvedPath: resolver.resolve(relPath, imp.source, parseResult.language),
    }));

    files[relPath] = {
      contentHash,
      language: parseResult.language,
      imports: resolvedImports,
      exports: parseResult.exports,
      importedBy: [],
    };
  }

  // Build reverse index (importedBy)
  for (const [filePath, entry] of Object.entries(files)) {
    for (const imp of entry.imports) {
      if (imp.resolvedPath && files[imp.resolvedPath]) {
        files[imp.resolvedPath].importedBy.push(filePath);
      }
    }
  }

  // Deduplicate importedBy
  for (const entry of Object.values(files)) {
    entry.importedBy = [...new Set(entry.importedBy)];
  }

  const index: CodebaseIndex = {
    version: 2,
    rootDir,
    indexedAt: new Date().toISOString(),
    files,
  };

  store.save(index);

  if (verbose) {
    console.log(`Index built: ${Object.keys(files).length} files indexed`);
  }

  return index;
}

function discoverFiles(rootDir: string): string[] {
  const results: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const fullPath = path.join(dir, entry.name);

        if (!isSupportedFile(entry.name)) continue;

        try {
          const stat = fs.statSync(fullPath);
          if (stat.size > MAX_FILE_SIZE) continue;
        } catch {
          continue;
        }

        results.push(path.relative(rootDir, fullPath));
      }
    }
  }

  walk(rootDir);
  return results;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}
