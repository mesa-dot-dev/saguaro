import { afterAll, describe, expect, test } from 'bun:test';
import { resetTreeSitter } from '../../init.js';
import { extractKotlin } from '../kotlin.js';

describe('kotlin extractor', () => {
  afterAll(() => resetTreeSitter());

  test('extracts single import', async () => {
    const code = `import com.example.Foo\n`;
    const result = await extractKotlin(code);
    expect(result.language).toBe('kotlin');
    expect(result.imports).toEqual([{ source: 'com.example', symbols: ['Foo'], kind: 'named' }]);
  });

  test('extracts wildcard import', async () => {
    const code = `import com.example.*\n`;
    const result = await extractKotlin(code);
    expect(result.imports).toEqual([{ source: 'com.example', symbols: [], kind: 'wildcard' }]);
  });

  test('extracts aliased import using original name', async () => {
    const code = `import com.example.Foo as Bar\n`;
    const result = await extractKotlin(code);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('com.example');
    expect(result.imports[0].symbols).toEqual(['Foo']);
  });

  test('extracts multiple imports', async () => {
    const code = `
import com.example.Foo
import com.example.Bar
import kotlin.collections.*
`;
    const result = await extractKotlin(code);
    expect(result.imports).toHaveLength(3);
    expect(result.imports[0].symbols).toEqual(['Foo']);
    expect(result.imports[1].symbols).toEqual(['Bar']);
    expect(result.imports[2].kind).toBe('wildcard');
  });

  test('exports class (default public)', async () => {
    const code = `
class MyService {
  fun serve() {}
}
`;
    const result = await extractKotlin(code);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('MyService');
    expect(result.exports.find((e) => e.name === 'MyService')?.kind).toBe('class');
  });

  test('exports object declaration', async () => {
    const code = `
object Singleton {
  val instance = 1
}
`;
    const result = await extractKotlin(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('Singleton');
    expect(result.exports[0].kind).toBe('class');
  });

  test('exports top-level function', async () => {
    const code = `
fun greet(name: String): String {
  return "Hello, $name"
}
`;
    const result = await extractKotlin(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('greet');
    expect(result.exports[0].kind).toBe('function');
    expect(result.exports[0].signature).toBeDefined();
  });

  test('exports top-level property', async () => {
    const code = `
val VERSION = "1.0.0"
`;
    const result = await extractKotlin(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('VERSION');
    expect(result.exports[0].kind).toBe('variable');
  });

  test('exports interface via class_declaration with interface keyword', async () => {
    const code = `
interface Handler {
  fun handle()
}
`;
    const result = await extractKotlin(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('Handler');
    expect(result.exports[0].kind).toBe('interface');
  });

  test('skips private declarations', async () => {
    const code = `
class PublicClass {}
private class PrivateClass {}
`;
    const result = await extractKotlin(code);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('PublicClass');
    expect(names).not.toContain('PrivateClass');
  });

  test('skips internal declarations', async () => {
    const code = `
class PublicClass {}
internal class InternalClass {}
`;
    const result = await extractKotlin(code);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('PublicClass');
    expect(names).not.toContain('InternalClass');
  });

  test('exports protected declarations (visible to subclasses)', async () => {
    const code = `
protected class ProtectedClass {}
`;
    const result = await extractKotlin(code);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('ProtectedClass');
  });
});
