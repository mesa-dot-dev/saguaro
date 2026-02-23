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
export async function getCodebaseContext(options: {
  rootDir: string;
  cacheDir: string;
  changedFiles: string[];
  blastRadiusDepth?: number;
  tokenBudget?: number;
  verbose?: boolean;
}): Promise<string> {
  const { rootDir, cacheDir, changedFiles, blastRadiusDepth = 1, tokenBudget, verbose } = options;

  try {
    const store = new JsonIndexStore(cacheDir);

    await buildIndex({ rootDir, store, verbose });

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
// Connection info — links an importer file to the changed files it imports from
// ---------------------------------------------------------------------------

interface ImporterConnection {
  changedFile: string;
  symbols: string[];
}

/**
 * For an importer file in the blast radius, find which changed files it imports from
 * and which symbols it uses.
 */
function getImporterConnection(entry: FileEntry, changedFiles: Set<string>): ImporterConnection[] {
  const connections: ImporterConnection[] = [];
  for (const imp of entry.imports) {
    if (imp.resolvedPath && changedFiles.has(imp.resolvedPath)) {
      connections.push({
        changedFile: imp.resolvedPath,
        symbols: collectImportSymbols(imp),
      });
    }
  }
  return connections;
}

function collectImportSymbols(imp: FileEntry['imports'][number]): string[] {
  const symbols = [...imp.symbols, ...(imp.typeSymbols ?? [])];
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
  blastRadius: Map<string, 'changed' | 'importer'>,
  changedFiles: Set<string>,
  store: JsonIndexStore,
  tokenBudget = DEFAULT_TOKEN_BUDGET
): string {
  const charBudget = tokenBudget * CHARS_PER_TOKEN;

  const priorityMap = { changed: 0, importer: 1 };
  const sorted = [...blastRadius.entries()].sort((a, b) => priorityMap[a[1]] - priorityMap[b[1]]);

  const sections: { text: string; priority: number }[] = [];

  for (const [filePath, relation] of sorted) {
    const entry = store.getFile(filePath);
    if (!entry) continue;

    const text =
      relation === 'changed'
        ? formatChangedFile(filePath, entry)
        : formatImporterFile(filePath, getImporterConnection(entry, changedFiles));

    sections.push({ text, priority: priorityMap[relation] });
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

// ---------------------------------------------------------------------------
// Formatters — changed files vs importer files
// ---------------------------------------------------------------------------

function formatChangedFile(filePath: string, entry: FileEntry): string {
  const lines: string[] = [`### ${filePath} (changed)`];
  const exportedSymbols = entry.exports.filter((e) => e.kind !== 're-export' && e.kind !== 're-export-all');
  if (exportedSymbols.length > 0) {
    lines.push(`Exports: ${exportedSymbols.map(formatExport).join(', ')}`);
  }
  if (entry.importedBy.length > 0) {
    lines.push(`Imported by: ${entry.importedBy.join(', ')}`);
  }
  return lines.join('\n');
}

function formatImporterFile(filePath: string, connections: ImporterConnection[]): string {
  if (connections.length === 0) {
    return `### ${filePath} (imports from changed file)`;
  }
  const parts = connections.map((c) => {
    const symbolStr = c.symbols.length > 0 ? ` ${c.symbols.join(', ')}` : '';
    return `imports${symbolStr} from ${c.changedFile}`;
  });
  return `### ${filePath} (${parts.join('; ')})`;
}

function formatExport(exp: ExportRef): string {
  const typePrefix = exp.isTypeOnly ? 'type ' : '';
  const sig = exp.signature ?? '';
  return `${typePrefix}${exp.name}${sig}`;
}
