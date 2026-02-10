import { logger } from '../../lib/logger.js';
import type { Language, ParseResult } from '../types.js';
import { SwcParser } from './swc-parser.js';

const SWC_EXTENSIONS: Record<string, Language> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
};

type SwcParserLike = { parse(filePath: string, content: string): ParseResult };

let parser: SwcParserLike | null | false = null; // false = failed to load

async function getParser(): Promise<SwcParserLike | null> {
  if (parser === false) return null;
  if (parser) return parser;

  try {
    parser = new SwcParser();
    return parser;
  } catch (error) {
    parser = false;
    const message = error instanceof Error ? error.message : String(error);
    logger.verbose(
      `[Mesa] Codebase indexing unavailable: @swc/core failed to load (${message}). Reviews will work without cross-file context.`
    );
    return null;
  }
}

export function detectLanguage(filePath: string): Language {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return 'unknown';
  return SWC_EXTENSIONS[filePath.slice(dot)] ?? 'unknown';
}

export async function parseFile(filePath: string, content: string): Promise<ParseResult> {
  const p = await getParser();
  if (!p) {
    return { language: detectLanguage(filePath), imports: [], exports: [] };
  }
  return p.parse(filePath, content);
}

export function isSupportedFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return filePath.slice(dot) in SWC_EXTENSIONS;
}
