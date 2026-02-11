import { afterAll, describe, expect, test } from 'bun:test';
import { detectLanguage, isSupportedFile, parseFile } from '../index.js';
import { resetTreeSitter } from '../tree-sitter/init.js';

describe('parser dispatch', () => {
  afterAll(() => resetTreeSitter());

  test('isSupportedFile accepts new extensions', () => {
    expect(isSupportedFile('foo.py')).toBe(true);
    expect(isSupportedFile('foo.go')).toBe(true);
    expect(isSupportedFile('foo.rs')).toBe(true);
    expect(isSupportedFile('foo.ts')).toBe(true);
    expect(isSupportedFile('foo.tsx')).toBe(true);
    expect(isSupportedFile('foo.js')).toBe(true);
    expect(isSupportedFile('foo.java')).toBe(true);
    expect(isSupportedFile('foo.kt')).toBe(true);
    expect(isSupportedFile('foo.txt')).toBe(false);
    expect(isSupportedFile('foo.md')).toBe(false);
  });

  test('detectLanguage returns correct language', () => {
    expect(detectLanguage('foo.py')).toBe('python');
    expect(detectLanguage('foo.go')).toBe('go');
    expect(detectLanguage('foo.rs')).toBe('rust');
    expect(detectLanguage('foo.ts')).toBe('typescript');
    expect(detectLanguage('foo.tsx')).toBe('tsx');
    expect(detectLanguage('foo.js')).toBe('javascript');
    expect(detectLanguage('foo.java')).toBe('java');
    expect(detectLanguage('foo.kt')).toBe('kotlin');
    expect(detectLanguage('foo.txt')).toBe('unknown');
  });

  test('parseFile routes Python to tree-sitter', async () => {
    const result = await parseFile('test.py', 'from os import path\n');
    expect(result.language).toBe('python');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('os');
  });

  test('parseFile routes Go to tree-sitter', async () => {
    const result = await parseFile('test.go', 'package main\n\nimport "fmt"\n');
    expect(result.language).toBe('go');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('fmt');
  });

  test('parseFile routes Rust to tree-sitter', async () => {
    const result = await parseFile('test.rs', 'use std::io::Read;\n');
    expect(result.language).toBe('rust');
    expect(result.imports).toHaveLength(1);
  });

  test('parseFile still routes TS to SWC', async () => {
    const result = await parseFile('test.ts', 'import { foo } from "./bar";\n');
    expect(result.language).toBe('typescript');
    expect(result.imports).toHaveLength(1);
  });

  test('parseFile routes Java to tree-sitter', async () => {
    const result = await parseFile('Test.java', 'import com.example.Foo;\n');
    expect(result.language).toBe('java');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('com.example');
  });

  test('parseFile routes Kotlin to tree-sitter', async () => {
    const result = await parseFile('Test.kt', 'import com.example.Foo\n');
    expect(result.language).toBe('kotlin');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('com.example');
  });

  test('parseFile returns empty for unsupported files', async () => {
    const result = await parseFile('test.txt', 'hello world');
    expect(result.language).toBe('unknown');
    expect(result.imports).toHaveLength(0);
    expect(result.exports).toHaveLength(0);
  });
});
