import path from 'node:path';
import { buildIndex } from './build.js';
import { JsonIndexStore } from './store.js';
import type { ExportRef, FileEntry } from './types.js';

export { JsonIndexStore } from './store.js';
export type { CodebaseIndex, ExportRef, FileEntry, ImportRef } from './types.js';

/**
 * Ensure the index exists (build if missing, update incrementally if stale),
 * compute blast radius from changed files, and return the context section
 * ready to inject into the review prompt.
 *
 * Returns empty string if indexing fails — reviews always work.
 */
export function getCodebaseContext(options: {
  rootDir: string;
  cacheDir: string;
  changedFiles: string[];
  blastRadiusDepth?: number;
  tokenBudget?: number;
  verbose?: boolean;
}): string {
  const { rootDir, cacheDir, changedFiles, blastRadiusDepth = 2, tokenBudget, verbose } = options;

  try {
    const store = new JsonIndexStore(cacheDir);

    buildIndex({ rootDir, store, verbose });

    const blastRadius = store.getBlastRadius(changedFiles, blastRadiusDepth);

    if (verbose) {
      console.log(`Blast radius: ${blastRadius.size} files (${changedFiles.length} changed)`);
    }

    return buildContextSection(blastRadius, new Set(changedFiles), store, tokenBudget);
  } catch (error) {
    if (verbose) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`Index failed (review continues without context): ${message}`);
    }
    return '';
  }
}

// ---------------------------------------------------------------------------
// Connection info — links a blast radius file to the changed files it relates to
// ---------------------------------------------------------------------------

interface FileConnection {
  changedFile: string;
  symbols: string[];
  direction: 'imports-from' | 'imported-by';
  /** True when the import is `import * as X from '...'` — all exports are considered used */
  hasNamespaceImport?: boolean;
  /** True when the import is `import X from '...'` — match the default export by isDefault, not name */
  hasDefaultImport?: boolean;
}

/**
 * For a non-changed file in the blast radius, find how it connects to changed files.
 *
 * - 'imports-from': this file imports symbols from a changed file
 * - 'imported-by': a changed file imports symbols from this file
 */
function getFileConnections(
  filePath: string,
  entry: FileEntry,
  changedFiles: Set<string>,
  changedEntries: Map<string, FileEntry>
): FileConnection[] {
  const connections: FileConnection[] = [];

  // This file imports from changed files (importer direction)
  for (const imp of entry.imports) {
    if (imp.resolvedPath && changedFiles.has(imp.resolvedPath)) {
      const symbols = collectImportSymbols(imp);
      connections.push({ changedFile: imp.resolvedPath, symbols, direction: 'imports-from' });
    }
  }

  // Changed files import from this file (dependency direction)
  for (const [changedFile, changedEntry] of changedEntries) {
    for (const imp of changedEntry.imports) {
      if (imp.resolvedPath === filePath) {
        connections.push({
          changedFile,
          symbols: collectImportSymbols(imp),
          hasNamespaceImport: imp.namespaceAlias != null,
          hasDefaultImport: imp.defaultAlias != null,
          direction: 'imported-by',
        });
      }
    }
  }

  return connections;
}

function collectImportSymbols(imp: FileEntry['imports'][number]): string[] {
  const symbols = [...imp.symbols, ...imp.typeSymbols];
  if (imp.defaultAlias) symbols.push(imp.defaultAlias);
  if (imp.namespaceAlias) symbols.push(`* as ${imp.namespaceAlias}`);
  return symbols;
}

// ---------------------------------------------------------------------------
// Context builder — generates the markdown section injected into the prompt
// ---------------------------------------------------------------------------

const DEFAULT_TOKEN_BUDGET = 4000;
const CHARS_PER_TOKEN = 4;

function buildContextSection(
  blastRadius: Map<string, 'changed' | 'importer' | 'dependency'>,
  changedFiles: Set<string>,
  store: JsonIndexStore,
  tokenBudget = DEFAULT_TOKEN_BUDGET
): string {
  const charBudget = tokenBudget * CHARS_PER_TOKEN;

  const priorityMap = { changed: 0, importer: 1, dependency: 2 };
  const sorted = [...blastRadius.entries()].sort((a, b) => priorityMap[a[1]] - priorityMap[b[1]]);

  // Pre-fetch changed file entries once to avoid repeated store lookups
  const changedEntries = new Map<string, FileEntry>();
  for (const cf of changedFiles) {
    const entry = store.getFile(cf);
    if (entry) changedEntries.set(cf, entry);
  }

  const sections: { text: string; priority: number }[] = [];

  for (const [filePath, relation] of sorted) {
    const entry = store.getFile(filePath);
    if (!entry) continue;

    const connections = relation === 'changed' ? [] : getFileConnections(filePath, entry, changedFiles, changedEntries);

    sections.push({
      text: formatFileContext(filePath, entry, relation, connections),
      priority: priorityMap[relation],
    });
  }

  let totalChars = 0;
  const included: string[] = [];

  for (const section of sections) {
    if (totalChars + section.text.length > charBudget) continue;
    included.push(section.text);
    totalChars += section.text.length;
  }

  if (included.length === 0) return '';

  return `## Codebase Context\n\n${included.join('\n\n')}`;
}

function formatFileContext(
  filePath: string,
  entry: FileEntry,
  relation: 'changed' | 'importer' | 'dependency',
  connections: FileConnection[]
): string {
  const label = buildRelationLabel(relation, connections);
  const lines: string[] = [`### ${filePath} ${label}`];

  const exportedSymbols = entry.exports.filter((e) => e.kind !== 're-export' && e.kind !== 're-export-all');

  if (relation === 'changed' || connections.length === 0) {
    // Changed files: show all exports. No connections: fallback to showing all.
    if (exportedSymbols.length > 0) {
      lines.push(`Exports: ${exportedSymbols.map(formatExport).join(', ')}`);
    }
  } else {
    // Non-changed files with connections: split into used vs other.
    // Only 'imported-by' connections determine which exports are "used" —
    // 'imports-from' connections describe what THIS file consumes, not what it provides.
    const importedByConns = connections.filter((c) => c.direction === 'imported-by');

    // Namespace import (`import * as X`) means all exports are used
    const allUsed = importedByConns.some((c) => c.hasNamespaceImport);

    const usedNames = new Set(importedByConns.flatMap((c) => c.symbols));
    const hasDefaultImport = importedByConns.some((c) => c.hasDefaultImport);

    const used = allUsed
      ? exportedSymbols
      : exportedSymbols.filter((e) => usedNames.has(e.name) || (hasDefaultImport && e.isDefault));
    const other = allUsed
      ? []
      : exportedSymbols.filter((e) => !usedNames.has(e.name) && !(hasDefaultImport && e.isDefault));

    if (used.length > 0) {
      lines.push(`Used symbols: ${used.map(formatExport).join(', ')}`);
      if (other.length > 0) {
        lines.push(`Also exports: ${other.map((e) => e.name).join(', ')}`);
      }
    } else if (exportedSymbols.length > 0) {
      // No used symbols (importer or no 'imported-by' connections): show all
      lines.push(`Exports: ${exportedSymbols.map(formatExport).join(', ')}`);
    }
  }

  const reExports = entry.exports.filter((e) => e.kind === 're-export' || e.kind === 're-export-all');
  if (reExports.length > 0) {
    for (const re of reExports) {
      if (re.kind === 're-export-all') {
        lines.push(`Re-exports all from: ${re.reExportSource}`);
      } else {
        lines.push(`Re-exports ${re.name} from: ${re.reExportSource}`);
      }
    }
  }

  const localImports = entry.imports.filter((imp) => imp.resolvedPath);
  if (localImports.length > 0) {
    const importLines = localImports.map((imp) => {
      const symbols = [...imp.symbols, ...imp.typeSymbols.map((s) => `type ${s}`)];
      const symbolStr = symbols.length > 0 ? `: ${symbols.join(', ')}` : '';
      return `${imp.resolvedPath}${symbolStr}`;
    });
    lines.push(`Imports from: ${importLines.join('; ')}`);
  }

  if (entry.importedBy.length > 0) {
    lines.push(`Imported by: ${entry.importedBy.join(', ')}`);
  }

  return lines.join('\n');
}

function buildRelationLabel(relation: 'changed' | 'importer' | 'dependency', connections: FileConnection[]): string {
  if (relation === 'changed') return '(changed)';

  if (connections.length === 0) {
    return relation === 'importer' ? '(imports from changed file)' : '(dependency of changed file)';
  }

  const parts = connections.map((c) => {
    const symbolStr = c.symbols.length > 0 ? ` ${c.symbols.join(', ')}` : '';
    if (c.direction === 'imports-from') {
      return `imports${symbolStr} from ${c.changedFile}`;
    }
    return `imported by ${c.changedFile}`;
  });

  return `(${parts.join('; ')})`;
}

function formatExport(exp: ExportRef): string {
  const typePrefix = exp.isTypeOnly ? 'type ' : '';
  const sig = exp.signature ?? '';
  return `${typePrefix}${exp.name}${sig}`;
}
