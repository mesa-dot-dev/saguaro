import { afterAll, describe, expect, test } from 'bun:test';
import { getLanguage, initTreeSitter, resetTreeSitter } from '../init.js';

describe('tree-sitter init', () => {
  afterAll(() => {
    resetTreeSitter();
  });

  test('initTreeSitter succeeds', async () => {
    await initTreeSitter();
  });

  test('getLanguage loads python grammar', async () => {
    const lang = await getLanguage('python');
    expect(lang).toBeDefined();
  });

  test('getLanguage loads go grammar', async () => {
    const lang = await getLanguage('go');
    expect(lang).toBeDefined();
  });

  test('getLanguage loads rust grammar', async () => {
    const lang = await getLanguage('rust');
    expect(lang).toBeDefined();
  });

  test('getLanguage caches grammars', async () => {
    const lang1 = await getLanguage('python');
    const lang2 = await getLanguage('python');
    expect(lang1).toBe(lang2);
  });
});
