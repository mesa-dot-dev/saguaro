import type { Language, ParseResult } from '../../types.js';
import { extractGo } from './languages/go.js';
import { extractJava } from './languages/java.js';
import { extractKotlin } from './languages/kotlin.js';
import { extractPython } from './languages/python.js';
import { extractRust } from './languages/rust.js';

type ExtractFn = (source: string) => Promise<ParseResult>;

const EXTRACTORS: Record<string, ExtractFn> = {
  python: extractPython,
  go: extractGo,
  rust: extractRust,
  java: extractJava,
  kotlin: extractKotlin,
};

export class TreeSitterParser {
  async parse(_filePath: string, content: string, language: Language): Promise<ParseResult> {
    const extractor = EXTRACTORS[language];
    if (!extractor) {
      return { language, imports: [], exports: [] };
    }
    return extractor(content);
  }
}
