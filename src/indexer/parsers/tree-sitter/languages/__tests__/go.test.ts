import { afterAll, describe, expect, test } from 'bun:test';
import { resetTreeSitter } from '../../init.js';
import { extractGo } from '../go.js';

describe('go extractor', () => {
  afterAll(() => resetTreeSitter());

  test('extracts single import', async () => {
    const code = `package main\n\nimport "fmt"\n`;
    const result = await extractGo(code);
    expect(result.language).toBe('go');
    expect(result.imports).toEqual([{ source: 'fmt', symbols: [], kind: 'namespace' }]);
  });

  test('extracts grouped imports', async () => {
    const code = `package main\n\nimport (\n\t"fmt"\n\t"os"\n)\n`;
    const result = await extractGo(code);
    expect(result.imports).toHaveLength(2);
    expect(result.imports[0].source).toBe('fmt');
    expect(result.imports[1].source).toBe('os');
  });

  test('extracts aliased import', async () => {
    const code = `package main\n\nimport alias "pkg/path"\n`;
    const result = await extractGo(code);
    expect(result.imports[0].source).toBe('pkg/path');
    expect(result.imports[0].kind).toBe('namespace');
  });

  test('extracts dot import as wildcard', async () => {
    const code = `package main\n\nimport . "testing"\n`;
    const result = await extractGo(code);
    expect(result.imports[0].kind).toBe('wildcard');
    expect(result.imports[0].source).toBe('testing');
  });

  test('exports only uppercase declarations', async () => {
    const code = `package main

func Serve(addr string) error {
	return nil
}

func helper() {}

type Handler struct {
	Name string
}

type internal struct{}

var ErrNotFound = 1
var count = 0

const MaxRetries = 3
const defaultTimeout = 30
`;
    const result = await extractGo(code);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('Serve');
    expect(names).toContain('Handler');
    expect(names).toContain('ErrNotFound');
    expect(names).toContain('MaxRetries');
    expect(names).not.toContain('helper');
    expect(names).not.toContain('internal');
    expect(names).not.toContain('count');
    expect(names).not.toContain('defaultTimeout');
  });

  test('extracts function signatures', async () => {
    const code = `package main\n\nfunc Serve(addr string, port int) error {\n\treturn nil\n}\n`;
    const result = await extractGo(code);
    expect(result.exports[0].signature).toContain('func Serve');
  });

  test('extracts interface declarations', async () => {
    const code = `package main\n\ntype Reader interface {\n\tRead(p []byte) (n int, err error)\n}\n`;
    const result = await extractGo(code);
    expect(result.exports[0].name).toBe('Reader');
    expect(result.exports[0].kind).toBe('interface');
  });

  test('maps struct to class kind', async () => {
    const code = `package main\n\ntype Config struct {\n\tName string\n}\n`;
    const result = await extractGo(code);
    expect(result.exports[0].kind).toBe('class');
  });
});
