import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getCodebaseContext, JsonIndexStore } from '../index.js';
import { resetTreeSitter } from '../parsers/tree-sitter/init.js';

function setupFixture(structure: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'integration-test-'));
  for (const [filePath, content] of Object.entries(structure)) {
    const abs = path.join(root, filePath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  // Create .mesa/cache dir
  fs.mkdirSync(path.join(root, '.mesa', 'cache'), { recursive: true });
  return root;
}

function cleanupFixture(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

describe('multi-language integration', () => {
  afterAll(() => resetTreeSitter());

  test('indexes a mixed-language repo and produces context', async () => {
    const root = setupFixture({
      'src/main.ts': `
import { Config } from './config';
export function serve(config: Config): void {}
`,
      'src/config.ts': `
export interface Config {
  port: number;
  host: string;
}
`,
      'scripts/deploy.py': `
from pathlib import Path

def deploy(target: str) -> bool:
    pass

class Deployer:
    pass
`,
      'pkg/auth/auth.go': `package auth

import "fmt"

func Authenticate(token string) error {
	return nil
}

type AuthResult struct {
	Valid bool
}
`,
      'src/lib.rs': `
use std::io::Read;

pub fn process(input: &str) -> Result<String, Error> {
    Ok(input.to_string())
}

pub struct Processor;
`,
      'src/main/java/com/example/Service.java': `
import com.example.Config;

public class Service {
  public void start() {}
}
`,
      'src/main/kotlin/com/example/App.kt': `
import com.example.Config

class App {
  fun run() {}
}

fun main() {}
`,
    });

    const cacheDir = path.join(root, '.mesa', 'cache');
    const context = await getCodebaseContext({
      rootDir: root,
      cacheDir,
      changedFiles: ['scripts/deploy.py'],
      blastRadiusDepth: 1,
      verbose: false,
    });

    // Verify the index was built
    const store = new JsonIndexStore(cacheDir);
    const index = store.load();
    expect(index).not.toBeNull();

    // Verify files from all languages were indexed
    const files = Object.keys(index!.files);
    expect(files.some((f) => f.endsWith('.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('.py'))).toBe(true);
    expect(files.some((f) => f.endsWith('.go'))).toBe(true);
    expect(files.some((f) => f.endsWith('.rs'))).toBe(true);

    // Verify Python file has correct exports
    const pyEntry = index!.files['scripts/deploy.py'];
    expect(pyEntry).toBeDefined();
    expect(pyEntry.language).toBe('python');
    const pyExportNames = pyEntry.exports.map((e) => e.name);
    expect(pyExportNames).toContain('deploy');
    expect(pyExportNames).toContain('Deployer');

    // Verify Go file has correct exports
    const goEntry = Object.values(index!.files).find((e) => e.language === 'go');
    expect(goEntry).toBeDefined();
    const goExportNames = goEntry!.exports.map((e) => e.name);
    expect(goExportNames).toContain('Authenticate');
    expect(goExportNames).toContain('AuthResult');

    // Verify Rust file has correct exports
    const rsEntry = Object.values(index!.files).find((e) => e.language === 'rust');
    expect(rsEntry).toBeDefined();
    const rsExportNames = rsEntry!.exports.map((e) => e.name);
    expect(rsExportNames).toContain('process');
    expect(rsExportNames).toContain('Processor');

    // Verify Java file has correct exports
    const javaEntry = Object.values(index!.files).find((e) => e.language === 'java');
    expect(javaEntry).toBeDefined();
    const javaExportNames = javaEntry!.exports.map((e) => e.name);
    expect(javaExportNames).toContain('Service');

    // Verify Kotlin file has correct exports
    const ktEntry = Object.values(index!.files).find((e) => e.language === 'kotlin');
    expect(ktEntry).toBeDefined();
    const ktExportNames = ktEntry!.exports.map((e) => e.name);
    expect(ktExportNames).toContain('App');
    expect(ktExportNames).toContain('main');

    // Verify .java and .kt files were indexed
    expect(files.some((f) => f.endsWith('.java'))).toBe(true);
    expect(files.some((f) => f.endsWith('.kt'))).toBe(true);

    // Context should include the changed Python file
    expect(context).toContain('deploy.py');

    cleanupFixture(root);
  });

  test('incremental indexing skips unchanged files', async () => {
    const root = setupFixture({
      'main.py': 'def hello(): pass\n',
    });

    const cacheDir = path.join(root, '.mesa', 'cache');

    // First build
    await getCodebaseContext({
      rootDir: root,
      cacheDir,
      changedFiles: ['main.py'],
    });

    const store = new JsonIndexStore(cacheDir);
    const firstHash = store.load()!.files['main.py'].contentHash;

    // Second build without changes — should skip
    await getCodebaseContext({
      rootDir: root,
      cacheDir,
      changedFiles: ['main.py'],
    });

    const secondHash = store.load()!.files['main.py'].contentHash;
    expect(secondHash).toBe(firstHash);

    cleanupFixture(root);
  });
});
