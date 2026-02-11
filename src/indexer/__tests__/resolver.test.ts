import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createResolver } from '../resolver.js';

/**
 * Create a temporary directory structure for testing resolution.
 */
function setupFixture(structure: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-test-'));
  for (const [filePath, content] of Object.entries(structure)) {
    const abs = path.join(root, filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function cleanupFixture(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe('python resolver', () => {
  let root: string;

  test('resolves relative from-import', () => {
    root = setupFixture({
      'src/utils.py': '',
      'src/main.py': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/main.py', '.utils', 'python');
    expect(result).toBe(path.join('src', 'utils.py'));
    cleanupFixture(root);
  });

  test('resolves package __init__.py', () => {
    root = setupFixture({
      'src/utils/__init__.py': '',
      'src/main.py': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/main.py', '.utils', 'python');
    expect(result).toBe(path.join('src', 'utils', '__init__.py'));
    cleanupFixture(root);
  });

  test('resolves absolute import to repo file', () => {
    root = setupFixture({
      'mypackage/helpers.py': '',
      'main.py': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('main.py', 'mypackage.helpers', 'python');
    expect(result).toBe(path.join('mypackage', 'helpers.py'));
    cleanupFixture(root);
  });

  test('returns null for stdlib imports', () => {
    root = setupFixture({ 'main.py': '' });
    const resolver = createResolver(root);
    const result = resolver.resolve('main.py', 'os', 'python');
    expect(result).toBeNull();
    cleanupFixture(root);
  });
});

describe('go resolver', () => {
  let root: string;

  test('resolves module-internal import', () => {
    root = setupFixture({
      'go.mod': 'module github.com/org/repo\n\ngo 1.21\n',
      'pkg/auth/auth.go': 'package auth',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('main.go', 'github.com/org/repo/pkg/auth', 'go');
    expect(result).toBe(path.join('pkg', 'auth'));
    cleanupFixture(root);
  });

  test('returns null for external packages', () => {
    root = setupFixture({
      'go.mod': 'module github.com/org/repo\n\ngo 1.21\n',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('main.go', 'fmt', 'go');
    expect(result).toBeNull();
    cleanupFixture(root);
  });

  test('returns null for external module imports', () => {
    root = setupFixture({
      'go.mod': 'module github.com/org/repo\n\ngo 1.21\n',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('main.go', 'github.com/other/lib', 'go');
    expect(result).toBeNull();
    cleanupFixture(root);
  });
});

describe('java resolver', () => {
  let root: string;

  test('resolves import to src/main/java file', () => {
    root = setupFixture({
      'src/main/java/com/example/Foo.java': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/main/java/com/example/Main.java', 'com.example.Foo', 'java');
    expect(result).toBe(path.join('src', 'main', 'java', 'com', 'example', 'Foo.java'));
    cleanupFixture(root);
  });

  test('resolves import to src root', () => {
    root = setupFixture({
      'src/com/example/Foo.java': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/com/example/Main.java', 'com.example.Foo', 'java');
    expect(result).toBe(path.join('src', 'com', 'example', 'Foo.java'));
    cleanupFixture(root);
  });

  test('returns null for java stdlib', () => {
    root = setupFixture({ 'Main.java': '' });
    const resolver = createResolver(root);
    expect(resolver.resolve('Main.java', 'java.util.List', 'java')).toBeNull();
    expect(resolver.resolve('Main.java', 'javax.servlet.http', 'java')).toBeNull();
    cleanupFixture(root);
  });

  test('returns null for missing file', () => {
    root = setupFixture({ 'Main.java': '' });
    const resolver = createResolver(root);
    expect(resolver.resolve('Main.java', 'com.example.Missing', 'java')).toBeNull();
    cleanupFixture(root);
  });

  test('resolves import in a Gradle multi-module project', () => {
    root = setupFixture({
      'build.gradle': '',
      'backend/build.gradle': '',
      'backend/src/main/java/com/example/Foo.java': '',
      'backend/src/main/java/com/example/Main.java': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('backend/src/main/java/com/example/Main.java', 'com.example.Foo', 'java');
    expect(result).toBe(path.join('backend', 'src', 'main', 'java', 'com', 'example', 'Foo.java'));
    cleanupFixture(root);
  });

  test('resolves import in a Maven multi-module project', () => {
    root = setupFixture({
      'pom.xml': '',
      'services/auth/pom.xml': '',
      'services/auth/src/main/java/com/example/Auth.java': '',
      'services/auth/src/main/java/com/example/Main.java': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('services/auth/src/main/java/com/example/Main.java', 'com.example.Auth', 'java');
    expect(result).toBe(path.join('services', 'auth', 'src', 'main', 'java', 'com', 'example', 'Auth.java'));
    cleanupFixture(root);
  });
});

describe('kotlin resolver', () => {
  let root: string;

  test('resolves import to src/main/kotlin file', () => {
    root = setupFixture({
      'src/main/kotlin/com/example/Foo.kt': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/main/kotlin/com/example/Main.kt', 'com.example.Foo', 'kotlin');
    expect(result).toBe(path.join('src', 'main', 'kotlin', 'com', 'example', 'Foo.kt'));
    cleanupFixture(root);
  });

  test('returns null for kotlin stdlib', () => {
    root = setupFixture({ 'Main.kt': '' });
    const resolver = createResolver(root);
    expect(resolver.resolve('Main.kt', 'kotlin.collections.List', 'kotlin')).toBeNull();
    expect(resolver.resolve('Main.kt', 'kotlinx.coroutines.launch', 'kotlin')).toBeNull();
    cleanupFixture(root);
  });

  test('returns null for android packages', () => {
    root = setupFixture({ 'Main.kt': '' });
    const resolver = createResolver(root);
    expect(resolver.resolve('Main.kt', 'android.os.Bundle', 'kotlin')).toBeNull();
    cleanupFixture(root);
  });

  test('resolves import in a Gradle multi-module project', () => {
    root = setupFixture({
      'build.gradle.kts': '',
      'app/build.gradle.kts': '',
      'app/src/main/kotlin/com/example/Foo.kt': '',
      'app/src/main/kotlin/com/example/Main.kt': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('app/src/main/kotlin/com/example/Main.kt', 'com.example.Foo', 'kotlin');
    expect(result).toBe(path.join('app', 'src', 'main', 'kotlin', 'com', 'example', 'Foo.kt'));
    cleanupFixture(root);
  });
});

describe('rust resolver', () => {
  let root: string;

  test('resolves crate::path to file', () => {
    root = setupFixture({
      'src/utils/helpers.rs': '',
      'src/main.rs': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/main.rs', 'crate::utils::helpers', 'rust');
    expect(result).toBe(path.join('src', 'utils', 'helpers.rs'));
    cleanupFixture(root);
  });

  test('resolves crate::path to mod.rs', () => {
    root = setupFixture({
      'src/utils/mod.rs': '',
      'src/main.rs': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/main.rs', 'crate::utils', 'rust');
    expect(result).toBe(path.join('src', 'utils', 'mod.rs'));
    cleanupFixture(root);
  });

  test('resolves super:: relative to importer', () => {
    root = setupFixture({
      'src/utils/mod.rs': '',
      'src/utils/helpers.rs': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/utils/helpers.rs', 'super', 'rust');
    // super from src/utils/helpers.rs → src/utils/mod.rs
    expect(result).toBe(path.join('src', 'utils', 'mod.rs'));
    cleanupFixture(root);
  });

  test('returns null for external crates', () => {
    root = setupFixture({ 'src/main.rs': '' });
    const resolver = createResolver(root);
    const result = resolver.resolve('src/main.rs', 'serde', 'rust');
    expect(result).toBeNull();
    cleanupFixture(root);
  });

  test('resolves crate:: in a workspace member', () => {
    root = setupFixture({
      'Cargo.toml': '[workspace]\nmembers = ["crates/*"]',
      'crates/my-crate/Cargo.toml': '[package]\nname = "my-crate"',
      'crates/my-crate/src/lib.rs': '',
      'crates/my-crate/src/utils/helpers.rs': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('crates/my-crate/src/lib.rs', 'crate::utils::helpers', 'rust');
    expect(result).toBe(path.join('crates', 'my-crate', 'src', 'utils', 'helpers.rs'));
    cleanupFixture(root);
  });

  test('resolves crate:: in deeply nested workspace member', () => {
    root = setupFixture({
      'packages/backend/Cargo.toml': '[package]\nname = "backend"',
      'packages/backend/src/main.rs': '',
      'packages/backend/src/routes/mod.rs': '',
    });
    const resolver = createResolver(root);
    const result = resolver.resolve('packages/backend/src/main.rs', 'crate::routes', 'rust');
    expect(result).toBe(path.join('packages', 'backend', 'src', 'routes', 'mod.rs'));
    cleanupFixture(root);
  });
});
