/**
 * Top-level index container. Serialized to disk.
 */
export interface CodebaseIndex {
  /** Schema version. Increment on breaking changes → forces full re-index */
  version: 2;
  /** Absolute path to the repository root */
  rootDir: string;
  /** ISO 8601 timestamp of last index build */
  indexedAt: string;
  /** Map from repo-relative file path → indexed entry */
  files: Record<string, FileEntry>;
}

export interface FileEntry {
  /** SHA-256 hex digest of file content at index time */
  contentHash: string;
  language: Language;
  imports: ImportRef[];
  exports: ExportRef[];
  /**
   * Reverse index: repo-relative paths of files that import from this file.
   * Computed during index build (not by the parser).
   */
  importedBy: string[];
}

export type Language =
  | 'typescript'
  | 'javascript'
  | 'tsx'
  | 'jsx'
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'kotlin'
  | 'unknown';

export interface ImportRef {
  /** Raw import specifier as written in source. NOT resolved */
  source: string;
  /** Resolved repo-relative file path, or null for external packages */
  resolvedPath: string | null;
  /** Named value imports */
  symbols: string[];
  /** Named type-only imports (JS/TS only) */
  typeSymbols?: string[];
  kind: 'named' | 'default' | 'namespace' | 'side-effect' | 'wildcard';
  /** Whether the entire import is type-only (JS/TS only) */
  isTypeOnly?: boolean;
  defaultAlias?: string;
  namespaceAlias?: string;
}

export interface ExportRef {
  name: string;
  kind: ExportKind;
  /**
   * Human-readable signature for the review agent prompt.
   * Functions: "(a: number, b: number): number"
   * Classes: "extends BaseService"
   * Variables: ": string[]"
   */
  signature?: string;
  isDefault: boolean;
  isTypeOnly: boolean;
  reExportSource?: string;
}

export type ExportKind =
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'enum'
  | 'variable'
  | 'constant'
  | 'trait'
  | 're-export'
  | 're-export-all';

/**
 * What a parser returns. No resolvedPath — resolution is a separate step.
 */
export interface ParseResult {
  language: Language;
  imports: Omit<ImportRef, 'resolvedPath'>[];
  exports: ExportRef[];
}
