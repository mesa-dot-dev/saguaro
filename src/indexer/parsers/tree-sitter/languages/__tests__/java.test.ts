import { afterAll, describe, expect, test } from 'bun:test';
import { resetTreeSitter } from '../../init.js';
import { extractJava } from '../java.js';

describe('java extractor', () => {
  afterAll(() => resetTreeSitter());

  test('extracts single import', async () => {
    const code = `import com.example.Foo;\n`;
    const result = await extractJava(code);
    expect(result.language).toBe('java');
    expect(result.imports).toEqual([{ source: 'com.example', symbols: ['Foo'], kind: 'named' }]);
  });

  test('extracts wildcard import', async () => {
    const code = `import com.example.*;\n`;
    const result = await extractJava(code);
    expect(result.imports).toEqual([{ source: 'com.example', symbols: [], kind: 'wildcard' }]);
  });

  test('extracts static import', async () => {
    const code = `import static com.example.Foo.bar;\n`;
    const result = await extractJava(code);
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('com.example.Foo');
    expect(result.imports[0].symbols).toEqual(['bar']);
    expect(result.imports[0].kind).toBe('named');
  });

  test('extracts multiple imports', async () => {
    const code = `
import com.example.Foo;
import com.example.Bar;
import java.util.*;
`;
    const result = await extractJava(code);
    expect(result.imports).toHaveLength(3);
    expect(result.imports[0].symbols).toEqual(['Foo']);
    expect(result.imports[1].symbols).toEqual(['Bar']);
    expect(result.imports[2].kind).toBe('wildcard');
  });

  test('exports public class', async () => {
    const code = `
public class MyService {
  public void serve() {}
}
`;
    const result = await extractJava(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('MyService');
    expect(result.exports[0].kind).toBe('class');
  });

  test('exports public interface', async () => {
    const code = `
public interface Handler {
  void handle();
}
`;
    const result = await extractJava(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('Handler');
    expect(result.exports[0].kind).toBe('interface');
  });

  test('exports public enum', async () => {
    const code = `
public enum Status {
  ACTIVE, INACTIVE
}
`;
    const result = await extractJava(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('Status');
    expect(result.exports[0].kind).toBe('enum');
  });

  test('skips non-public declarations', async () => {
    const code = `
public class PublicClass {}
class PackagePrivateClass {}
`;
    const result = await extractJava(code);
    const names = result.exports.map((e) => e.name);
    expect(names).toContain('PublicClass');
    expect(names).not.toContain('PackagePrivateClass');
  });

  test('extracts class with extends/implements signature', async () => {
    const code = `
public class MyService extends BaseService implements Handler, Closeable {
  public void serve() {}
}
`;
    const result = await extractJava(code);
    expect(result.exports).toHaveLength(1);
    const sig = result.exports[0].signature;
    expect(sig).toBeDefined();
    expect(sig).toContain('extends');
    expect(sig).toContain('implements');
  });

  test('exports public record as class', async () => {
    const code = `
public record Point(int x, int y) {}
`;
    const result = await extractJava(code);
    expect(result.exports).toHaveLength(1);
    expect(result.exports[0].name).toBe('Point');
    expect(result.exports[0].kind).toBe('class');
  });
});
