import { logger } from '../../util/logger.js';
import type { Language, ParseResult } from '../types.js';
import { SwcParser } from './swc-parser.js';
import { TreeSitterParser } from './tree-sitter/parser.js';

const SWC_EXTENSIONS: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
};

const TREE_SITTER_EXTENSIONS: Record<string, Language> = {
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
};

type SwcParserLike = { parse(filePath: string, content: string): ParseResult };

let swcParser: SwcParserLike | null | false = null; // false = failed to load
let treeSitterParser: TreeSitterParser | null | false = null;

async function getSwcParser(): Promise<SwcParserLike | null> {
  if (swcParser === false) return null;
  if (swcParser) return swcParser;

  try {
    swcParser = new SwcParser();
    return swcParser;
  } catch (error) {
    swcParser = false;
    const message = error instanceof Error ? error.message : String(error);
    logger.verbose(
      `[Saguaro] Codebase indexing unavailable: @swc/core failed to load (${message}). Reviews will work without cross-file context.`
    );
    return null;
  }
}

async function getTreeSitterParser(): Promise<TreeSitterParser | null> {
  if (treeSitterParser === false) return null;
  if (treeSitterParser) return treeSitterParser;

  try {
    treeSitterParser = new TreeSitterParser();
    return treeSitterParser;
  } catch (error) {
    treeSitterParser = false;
    const message = error instanceof Error ? error.message : String(error);
    logger.verbose(
      `[Saguaro] Tree-sitter indexing unavailable: ${message}. Reviews will work without cross-file context for Python/Go/Rust.`
    );
    return null;
  }
}

export function detectLanguage(filePath: string): Language {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return 'unknown';
  const ext = filePath.slice(dot);
  return SWC_EXTENSIONS[ext] ?? TREE_SITTER_EXTENSIONS[ext] ?? 'unknown';
}

export async function parseFile(filePath: string, content: string): Promise<ParseResult> {
  const dot = filePath.lastIndexOf('.');
  const ext = dot === -1 ? '' : filePath.slice(dot);
  const language = detectLanguage(filePath);

  // Route to SWC for TS/JS
  if (ext in SWC_EXTENSIONS) {
    const p = await getSwcParser();
    if (!p) return { language, imports: [], exports: [] };
    return p.parse(filePath, content);
  }

  // Route to tree-sitter for Python/Go/Rust
  if (ext in TREE_SITTER_EXTENSIONS) {
    const ts = await getTreeSitterParser();
    if (!ts) return { language, imports: [], exports: [] };
    return ts.parse(filePath, content, language);
  }

  return { language: 'unknown', imports: [], exports: [] };
}

export function isSupportedFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = filePath.slice(dot);
  return ext in SWC_EXTENSIONS || ext in TREE_SITTER_EXTENSIONS;
}
