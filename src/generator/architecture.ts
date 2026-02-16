import type { CodebaseIndex } from '../indexer/types.js';

/**
 * Extracts the architectural directory (depth-2 grouping) from a file path.
 *
 *   src/core/review.ts     → src/core
 *   src/cli/bin/index.ts   → src/cli
 *   index.ts               → .
 */
function getArchitecturalDir(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length <= 2) return parts.length === 1 ? '.' : parts.slice(0, 2).join('/');
  return parts.slice(0, 2).join('/');
}

interface DirSummary {
  fileCount: number;
  internalDeps: Set<string>;
  importedByDirs: Set<string>;
  nodeBuiltins: Set<string>;
  externalPackages: Set<string>;
  interfaceExports: string[];
}

/**
 * Computes an architectural context string from the codebase index for a set
 * of zone files. Returns null if fewer than 2 architectural directories exist
 * (no architectural structure to show).
 */
export function computeArchitecturalContext(index: CodebaseIndex | null, zoneFiles: string[]): string | null {
  if (!index) return null;

  const dirs = new Map<string, DirSummary>();

  for (const filePath of zoneFiles) {
    const entry = index.files[filePath];
    if (!entry) continue;

    const dir = getArchitecturalDir(filePath);
    let summary = dirs.get(dir);
    if (!summary) {
      summary = {
        fileCount: 0,
        internalDeps: new Set(),
        importedByDirs: new Set(),
        nodeBuiltins: new Set(),
        externalPackages: new Set(),
        interfaceExports: [],
      };
      dirs.set(dir, summary);
    }

    summary.fileCount++;

    for (const imp of entry.imports) {
      // Node builtins: node:fs, node:path, etc.
      if (imp.source.startsWith('node:')) {
        summary.nodeBuiltins.add(imp.source);
        continue;
      }

      // Internal dependency — resolved to another file in the repo
      if (imp.resolvedPath) {
        const depDir = getArchitecturalDir(imp.resolvedPath);
        if (depDir !== dir) {
          summary.internalDeps.add(depDir);
        }
        continue;
      }

      // External package — not resolved and not a relative path
      if (!imp.source.startsWith('.')) {
        // Extract package name (handle scoped packages like @foo/bar)
        const parts = imp.source.split('/');
        const pkgName = imp.source.startsWith('@') && parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
        summary.externalPackages.add(pkgName);
      }
    }

    // Collect reverse dependencies (which dirs import files in this dir)
    for (const importerPath of entry.importedBy) {
      const importerDir = getArchitecturalDir(importerPath);
      if (importerDir !== dir) {
        summary.importedByDirs.add(importerDir);
      }
    }

    // Collect interface/type exports
    for (const exp of entry.exports) {
      if (exp.kind === 'interface' || exp.kind === 'type') {
        summary.interfaceExports.push(exp.name);
      }
    }
  }

  // Need at least 2 directories to show architectural structure
  if (dirs.size < 2) return null;

  // Check if ANY directory in the zone uses node builtins
  const anyDirUsesBuiltins = Array.from(dirs.values()).some((d) => d.nodeBuiltins.size > 0);

  const lines: string[] = [];
  lines.push('## Architectural Overview (computed from import graph)');
  lines.push('');

  // Sort directories alphabetically for deterministic output
  const sortedDirs = Array.from(dirs.entries()).sort(([a], [b]) => a.localeCompare(b));

  for (const [dir, summary] of sortedDirs) {
    lines.push(`### ${dir}/ (${summary.fileCount} files)`);

    if (summary.internalDeps.size > 0) {
      const deps = Array.from(summary.internalDeps).sort();
      lines.push(`- Imports from: ${deps.join(', ')}`);
    }

    if (summary.importedByDirs.size > 0) {
      const importers = Array.from(summary.importedByDirs).sort();
      lines.push(`- Imported by: ${importers.join(', ')}`);
    }

    if (summary.nodeBuiltins.size > 0) {
      const builtins = Array.from(summary.nodeBuiltins).sort();
      lines.push(`- Node builtins: ${builtins.join(', ')}`);
    } else if (anyDirUsesBuiltins) {
      lines.push('- Node builtins: **none** (pure logic \u2014 no I/O imports)');
    }

    if (summary.externalPackages.size > 0) {
      const pkgs = Array.from(summary.externalPackages).sort();
      lines.push(`- External packages: ${pkgs.join(', ')}`);
    }

    if (summary.interfaceExports.length > 0) {
      const types = summary.interfaceExports.sort();
      const display = types.length > 8 ? `${types.slice(0, 8).join(', ')}, ...` : types.join(', ');
      lines.push(`- Defines interfaces/types: ${display}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}
