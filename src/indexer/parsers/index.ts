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

let parser: SwcParser | null = null;

function getParser(): SwcParser {
  if (!parser) parser = new SwcParser();
  return parser;
}

export function detectLanguage(filePath: string): Language {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return 'unknown';
  return SWC_EXTENSIONS[filePath.slice(dot)] ?? 'unknown';
}

export function parseFile(filePath: string, content: string): ParseResult {
  return getParser().parse(filePath, content);
}

export function isSupportedFile(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return false;
  return filePath.slice(dot) in SWC_EXTENSIONS;
}
