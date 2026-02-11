import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// web-tree-sitter exports Parser and Language as separate named exports.
// We import them dynamically to keep the module lazy-loadable.
type TreeSitterParser = import('web-tree-sitter').Parser;
type TreeSitterLanguage = import('web-tree-sitter').Language;
type ParserConstructor = new () => TreeSitterParser;

const GRAMMAR_FILES: Record<string, string> = {
  python: 'tree-sitter-wasms/out/tree-sitter-python.wasm',
  go: 'tree-sitter-wasms/out/tree-sitter-go.wasm',
  rust: 'tree-sitter-wasms/out/tree-sitter-rust.wasm',
  java: 'tree-sitter-wasms/out/tree-sitter-java.wasm',
  kotlin: 'tree-sitter-wasms/out/tree-sitter-kotlin.wasm',
};

let ParserCtor: ParserConstructor | null = null;
let LanguageClass: { load(path: string): Promise<TreeSitterLanguage> } | null = null;
const grammars = new Map<string, TreeSitterLanguage>();

/**
 * Initialize the web-tree-sitter WASM runtime. Safe to call multiple times.
 */
export async function initTreeSitter(): Promise<void> {
  if (ParserCtor) return;

  const mod = await import('web-tree-sitter');
  const { Parser, Language } = mod;
  await Parser.init();
  ParserCtor = Parser as unknown as ParserConstructor;
  LanguageClass = Language as unknown as { load(path: string): Promise<TreeSitterLanguage> };
}

/**
 * Load and cache a tree-sitter grammar for a given language.
 * Automatically initializes the runtime if needed.
 */
export async function getLanguage(lang: string): Promise<TreeSitterLanguage> {
  const cached = grammars.get(lang);
  if (cached) return cached;

  await initTreeSitter();

  const specifier = GRAMMAR_FILES[lang];
  if (!specifier) {
    throw new Error(`No tree-sitter grammar configured for language: ${lang}`);
  }

  const wasmPath = require.resolve(specifier);
  const grammar = await LanguageClass!.load(wasmPath);
  grammars.set(lang, grammar);
  return grammar;
}

/**
 * Create a new Parser instance with the given language set.
 * Caller is responsible for cleanup (parser.delete()).
 */
export async function createParser(lang: string): Promise<TreeSitterParser> {
  await initTreeSitter();
  const grammar = await getLanguage(lang);
  const parser = new ParserCtor!();
  parser.setLanguage(grammar);
  return parser;
}

/**
 * Reset all cached state. Used in tests.
 */
export function resetTreeSitter(): void {
  ParserCtor = null;
  LanguageClass = null;
  grammars.clear();
}
