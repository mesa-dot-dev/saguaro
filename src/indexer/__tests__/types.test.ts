import { describe, expect, test } from 'bun:test';
import type { ExportKind, ImportRef, Language, ParseResult } from '../types.js';

describe('unified types', () => {
  test('Language includes python, go, rust', () => {
    const langs: Language[] = ['python', 'go', 'rust', 'typescript', 'javascript', 'tsx', 'jsx', 'unknown'];
    expect(langs).toHaveLength(8);
  });

  test('ImportRef allows optional JS-specific fields', () => {
    // Python import — no typeSymbols, no defaultAlias, no namespaceAlias
    const pythonImport: ImportRef = {
      source: 'os.path',
      resolvedPath: 'lib/path.py',
      symbols: ['join', 'exists'],
      kind: 'named',
    };
    expect(pythonImport.typeSymbols).toBeUndefined();
    expect(pythonImport.isTypeOnly).toBeUndefined();
    expect(pythonImport.defaultAlias).toBeUndefined();
    expect(pythonImport.namespaceAlias).toBeUndefined();
  });

  test('ImportRef kind includes wildcard', () => {
    const wildcardImport: ImportRef = {
      source: 'utils',
      resolvedPath: 'utils.py',
      symbols: [],
      kind: 'wildcard',
    };
    expect(wildcardImport.kind).toBe('wildcard');
  });

  test('ExportKind includes trait', () => {
    const kind: ExportKind = 'trait';
    expect(kind).toBe('trait');
  });

  test('ParseResult works with minimal fields', () => {
    const result: ParseResult = {
      language: 'python',
      imports: [{ source: 'os', symbols: ['path'], kind: 'named' }],
      exports: [{ name: 'main', kind: 'function', isDefault: false, isTypeOnly: false }],
    };
    expect(result.imports).toHaveLength(1);
    expect(result.exports).toHaveLength(1);
  });
});
