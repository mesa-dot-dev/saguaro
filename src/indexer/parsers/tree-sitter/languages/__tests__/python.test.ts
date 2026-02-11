import { afterAll, describe, expect, test } from 'bun:test';
import { resetTreeSitter } from '../../init.js';
import { extractPython } from '../python.js';

describe('python extractor', () => {
  afterAll(() => resetTreeSitter());

  test('extracts from-import with named symbols', async () => {
    const result = await extractPython('from os.path import join, exists\n');
    expect(result.language).toBe('python');
    expect(result.imports).toEqual([{ source: 'os.path', symbols: ['join', 'exists'], kind: 'named' }]);
  });

  test('extracts plain import as namespace', async () => {
    const result = await extractPython('import os\n');
    expect(result.imports).toEqual([{ source: 'os', symbols: [], kind: 'namespace' }]);
  });

  test('extracts dotted plain import', async () => {
    const result = await extractPython('import os.path\n');
    expect(result.imports).toEqual([{ source: 'os.path', symbols: [], kind: 'namespace' }]);
  });

  test('extracts wildcard import', async () => {
    const result = await extractPython('from utils import *\n');
    expect(result.imports).toEqual([{ source: 'utils', symbols: [], kind: 'wildcard' }]);
  });

  test('extracts relative import with dots', async () => {
    const result = await extractPython('from ..utils import helper\n');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('..utils');
    expect(result.imports[0].symbols).toEqual(['helper']);
    expect(result.imports[0].kind).toBe('named');
  });

  test('extracts bare relative import', async () => {
    const result = await extractPython('from . import utils\n');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('.');
    expect(result.imports[0].symbols).toEqual(['utils']);
  });

  test('extracts aliased import by original name', async () => {
    const result = await extractPython('from foo import bar as baz, qux\n');
    expect(result.imports[0].symbols).toEqual(['bar', 'qux']);
  });

  test('extracts top-level function exports', async () => {
    const code = `
def main(x: int, y: str) -> bool:
    pass

async def fetch_data(url: str):
    pass
`;
    const result = await extractPython(code);
    expect(result.exports).toHaveLength(2);
    expect(result.exports[0].name).toBe('main');
    expect(result.exports[0].kind).toBe('function');
    expect(result.exports[0].signature).toContain('def main');
    expect(result.exports[1].name).toBe('fetch_data');
    expect(result.exports[1].signature).toContain('async def fetch_data');
  });

  test('extracts top-level class exports', async () => {
    const code = `
class MyHandler:
    pass

class ChildHandler(MyHandler):
    pass
`;
    const result = await extractPython(code);
    expect(result.exports).toHaveLength(2);
    expect(result.exports[0].name).toBe('MyHandler');
    expect(result.exports[0].kind).toBe('class');
    expect(result.exports[1].name).toBe('ChildHandler');
  });

  test('extracts top-level variable assignments', async () => {
    const code = `
MAX_RETRIES = 3
DEFAULT_TIMEOUT: int = 30
`;
    const result = await extractPython(code);
    const varExports = result.exports.filter((e) => e.kind === 'variable');
    expect(varExports).toHaveLength(2);
    expect(varExports.map((e) => e.name)).toContain('MAX_RETRIES');
    expect(varExports.map((e) => e.name)).toContain('DEFAULT_TIMEOUT');
  });

  test('ignores nested definitions', async () => {
    const code = `
def outer():
    def inner():
        pass
    class InnerClass:
        pass
`;
    const result = await extractPython(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('outer');
  });

  test('extracts decorated definitions', async () => {
    const code = `
@app.route('/api')
def handle_request():
    pass

@dataclass
class Config:
    name: str
`;
    const result = await extractPython(code);
    expect(result.exports).toHaveLength(2);
    expect(result.exports[0].name).toBe('handle_request');
    expect(result.exports[0].kind).toBe('function');
    expect(result.exports[1].name).toBe('Config');
    expect(result.exports[1].kind).toBe('class');
  });
});
