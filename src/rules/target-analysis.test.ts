/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyzeTarget, resolveTargetDirectory } from './target-analysis.js';

function withTempRepo(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saguaro-target-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('analyzeTarget', () => {
  test('samples files from target directory only', () => {
    withTempRepo((root) => {
      // Create a target with files
      const targetPath = path.join(root, 'src', 'cli');
      fs.mkdirSync(targetPath, { recursive: true });
      fs.writeFileSync(path.join(targetPath, 'commands.ts'), 'export function run() {}');
      fs.writeFileSync(path.join(targetPath, 'utils.ts'), 'export function parse() {}');

      // Create files outside target
      const otherPath = path.join(root, 'src', 'lib');
      fs.mkdirSync(otherPath, { recursive: true });
      fs.writeFileSync(path.join(otherPath, 'core.ts'), 'export function core() {}');

      const result = analyzeTarget({
        targetPath: 'src/cli',
        repoRoot: root,
      });

      expect(result.files.length).toBe(2);
      expect(result.files.every((f) => f.filePath.startsWith('src/cli'))).toBe(true);
      expect(result.files.find((f) => f.filePath.includes('lib/core.ts'))).toBeUndefined();
    });
  });

  test('samples boundary files from sibling directories', () => {
    withTempRepo((root) => {
      // Create target
      const targetPath = path.join(root, 'src', 'cli');
      fs.mkdirSync(targetPath, { recursive: true });
      fs.writeFileSync(path.join(targetPath, 'cli.ts'), 'cli code');

      // Create sibling directories
      const libPath = path.join(root, 'src', 'lib');
      fs.mkdirSync(libPath, { recursive: true });
      fs.writeFileSync(path.join(libPath, 'lib.ts'), 'lib code');

      const adapterPath = path.join(root, 'src', 'adapter');
      fs.mkdirSync(adapterPath, { recursive: true });
      fs.writeFileSync(path.join(adapterPath, 'adapter.ts'), 'adapter code');

      const result = analyzeTarget({
        targetPath: 'src/cli',
        repoRoot: root,
      });

      // Should have boundary files from siblings
      expect(result.boundaryFiles.length).toBeGreaterThan(0);
      expect(result.boundaryFiles.length).toBeLessThanOrEqual(3);
      // Boundary files should NOT be from the target
      expect(result.boundaryFiles.every((f) => !f.filePath.startsWith('src/cli'))).toBe(true);
      // Should be from siblings
      expect(
        result.boundaryFiles.some((f) => f.filePath.startsWith('src/lib') || f.filePath.startsWith('src/adapter'))
      ).toBe(true);
    });
  });

  test('truncates file content to 3000 chars', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src');
      fs.mkdirSync(targetPath, { recursive: true });

      const longContent = 'a'.repeat(5000);
      fs.writeFileSync(path.join(targetPath, 'long.ts'), longContent);

      const result = analyzeTarget({
        targetPath: 'src',
        repoRoot: root,
      });

      const longFile = result.files.find((f) => f.filePath === 'src/long.ts');
      expect(longFile).toBeDefined();
      expect(longFile!.content.length).toBeLessThanOrEqual(3100); // 3000 + truncation message
      expect(longFile!.content).toContain('[truncated');
    });
  });

  test('generates directory tree with target marker', () => {
    withTempRepo((root) => {
      const srcPath = path.join(root, 'src');
      fs.mkdirSync(srcPath);

      const cliPath = path.join(srcPath, 'cli');
      fs.mkdirSync(cliPath);
      fs.mkdirSync(path.join(cliPath, 'lib'));

      fs.mkdirSync(path.join(srcPath, 'adapter'));
      fs.mkdirSync(path.join(srcPath, 'core'));

      const result = analyzeTarget({
        targetPath: 'src/cli',
        repoRoot: root,
      });

      expect(result.directoryTree).toContain('cli');
      expect(result.directoryTree).toContain('← target');
      expect(result.directoryTree).toContain('adapter');
      expect(result.directoryTree).toContain('core');
    });
  });

  test('generates suggested globs scoped to target', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'packages', 'web', 'src');
      fs.mkdirSync(targetPath, { recursive: true });
      fs.writeFileSync(path.join(targetPath, 'app.ts'), 'code');
      fs.writeFileSync(path.join(targetPath, 'utils.tsx'), 'code');

      const result = analyzeTarget({
        targetPath: 'packages/web/src',
        repoRoot: root,
      });

      expect(result.suggestedGlobs.length).toBeGreaterThan(0);
      expect(result.suggestedGlobs.some((g) => g.includes('packages/web/src'))).toBe(true);
      expect(result.suggestedGlobs.some((g) => g.includes('!**/*.test.*'))).toBe(true);
      expect(result.suggestedGlobs.some((g) => g.includes('!**/*.spec.*'))).toBe(true);
    });
  });

  test('detects typescript language from extensions', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src');
      fs.mkdirSync(targetPath, { recursive: true });
      fs.writeFileSync(path.join(targetPath, 'app.ts'), 'code');
      fs.writeFileSync(path.join(targetPath, 'component.tsx'), 'code');

      const result = analyzeTarget({
        targetPath: 'src',
        repoRoot: root,
      });

      expect(result.detectedLanguages).toContain('typescript');
    });
  });

  test('detects multiple languages', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src');
      fs.mkdirSync(targetPath, { recursive: true });
      fs.writeFileSync(path.join(targetPath, 'app.py'), 'code');
      fs.writeFileSync(path.join(targetPath, 'utils.rs'), 'code');
      fs.writeFileSync(path.join(targetPath, 'main.go'), 'code');

      const result = analyzeTarget({
        targetPath: 'src',
        repoRoot: root,
      });

      expect(result.detectedLanguages).toContain('python');
      expect(result.detectedLanguages).toContain('rust');
      expect(result.detectedLanguages).toContain('go');
    });
  });

  test('includes collocated placement as recommended', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src', 'cli');
      fs.mkdirSync(targetPath, { recursive: true });
      fs.writeFileSync(path.join(targetPath, 'index.ts'), 'code');

      const result = analyzeTarget({
        targetPath: 'src/cli',
        repoRoot: root,
      });

      const collocated = result.placements.find((p) => p.type === 'collocated');
      expect(collocated).toBeDefined();
      expect(collocated!.recommended).toBe(true);
      expect(collocated!.skillsDir).toBe(path.join(root, 'src', 'cli', '.claude', 'skills'));
      expect(collocated!.label).toContain('collocated');
    });
  });

  test('includes package placement when package.json exists', () => {
    withTempRepo((root) => {
      const pkgPath = path.join(root, 'packages', 'web');
      fs.mkdirSync(pkgPath, { recursive: true });
      fs.writeFileSync(path.join(pkgPath, 'package.json'), '{}');

      const targetPath = path.join(pkgPath, 'src', 'components');
      fs.mkdirSync(targetPath, { recursive: true });
      fs.writeFileSync(path.join(targetPath, 'Button.tsx'), 'code');

      const result = analyzeTarget({
        targetPath: 'packages/web/src/components',
        repoRoot: root,
      });

      const pkg = result.placements.find((p) => p.type === 'package');
      expect(pkg).toBeDefined();
      expect(pkg!.skillsDir).toBe(path.join(root, 'packages', 'web', '.claude', 'skills'));
      expect(pkg!.label).toContain('web');
    });
  });

  test('includes root placement', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src');
      fs.mkdirSync(targetPath, { recursive: true });

      const result = analyzeTarget({
        targetPath: 'src',
        repoRoot: root,
      });

      const rootPlacement = result.placements.find((p) => p.type === 'root');
      expect(rootPlacement).toBeDefined();
      expect(rootPlacement!.skillsDir).toBe(path.join(root, '.claude', 'skills'));
      expect(rootPlacement!.label).toContain('root');
    });
  });

  test('marks existing skills dir as type existing', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src', 'cli');
      fs.mkdirSync(targetPath, { recursive: true });

      // Create existing skills dir at target
      const skillsPath = path.join(targetPath, '.claude', 'skills');
      fs.mkdirSync(skillsPath, { recursive: true });

      const result = analyzeTarget({
        targetPath: 'src/cli',
        repoRoot: root,
      });

      const collocated = result.placements.find((p) => p.skillsDir === skillsPath);
      expect(collocated).toBeDefined();
      expect(collocated!.type).toBe('existing');
    });
  });

  test('deduplicates collocated and package when same path', () => {
    withTempRepo((root) => {
      const pkgPath = path.join(root, 'packages', 'core');
      fs.mkdirSync(pkgPath, { recursive: true });
      fs.writeFileSync(path.join(pkgPath, 'package.json'), '{}');

      const result = analyzeTarget({
        targetPath: 'packages/core',
        repoRoot: root,
      });

      const skillsDir = path.join(root, 'packages', 'core', '.claude', 'skills');
      const matches = result.placements.filter((p) => p.skillsDir === skillsDir);
      expect(matches.length).toBe(1);
      expect(matches[0]!.type).toBe('collocated');
    });
  });

  test('handles target at repo root', () => {
    withTempRepo((root) => {
      fs.writeFileSync(path.join(root, 'README.md'), 'readme');

      const result = analyzeTarget({
        targetPath: '.',
        repoRoot: root,
      });

      expect(result.resolvedPath).toBe(root);
      expect(result.relativePath).toBe('.');

      // Should only have root placement, no collocated (since they're the same)
      expect(result.placements.length).toBe(1);
      expect(result.placements[0]!.type).toBe('root');
    });
  });

  test('throws for completely nonexistent target path', () => {
    withTempRepo((root) => {
      expect(() =>
        analyzeTarget({
          targetPath: 'nonexistent/path',
          repoRoot: root,
        })
      ).toThrow('Could not find directory matching');
    });
  });

  test('returns deterministic file order', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src');
      fs.mkdirSync(targetPath, { recursive: true });

      // Create files in random order
      fs.writeFileSync(path.join(targetPath, 'zebra.ts'), 'z');
      fs.writeFileSync(path.join(targetPath, 'alpha.ts'), 'a');
      fs.writeFileSync(path.join(targetPath, 'beta.ts'), 'b');

      const result1 = analyzeTarget({ targetPath: 'src', repoRoot: root });
      const result2 = analyzeTarget({ targetPath: 'src', repoRoot: root });

      expect(result1.files.map((f) => f.filePath)).toEqual(result2.files.map((f) => f.filePath));
    });
  });

  test('caps file sampling at 5 files', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src');
      fs.mkdirSync(targetPath, { recursive: true });

      // Create 10 files
      for (let i = 0; i < 10; i++) {
        fs.writeFileSync(path.join(targetPath, `file${i}.ts`), `content ${i}`);
      }

      const result = analyzeTarget({
        targetPath: 'src',
        repoRoot: root,
      });

      expect(result.files.length).toBeLessThanOrEqual(5);
    });
  });

  test('skips ignored directories when sampling', () => {
    withTempRepo((root) => {
      const targetPath = path.join(root, 'src');
      fs.mkdirSync(targetPath, { recursive: true });

      // Create file in target
      fs.writeFileSync(path.join(targetPath, 'app.ts'), 'code');

      // Create files in ignored dirs
      const nodeModules = path.join(targetPath, 'node_modules');
      fs.mkdirSync(nodeModules);
      fs.writeFileSync(path.join(nodeModules, 'lib.js'), 'code');

      const dist = path.join(targetPath, 'dist');
      fs.mkdirSync(dist);
      fs.writeFileSync(path.join(dist, 'bundle.js'), 'code');

      const result = analyzeTarget({
        targetPath: 'src',
        repoRoot: root,
      });

      expect(result.files.every((f) => !f.filePath.includes('node_modules'))).toBe(true);
      expect(result.files.every((f) => !f.filePath.includes('dist'))).toBe(true);
    });
  });

  test('detects Cargo.toml as package boundary', () => {
    withTempRepo((root) => {
      const cratePath = path.join(root, 'crates', 'engine');
      fs.mkdirSync(cratePath, { recursive: true });
      fs.writeFileSync(path.join(cratePath, 'Cargo.toml'), '[package]');

      const targetPath = path.join(cratePath, 'src');
      fs.mkdirSync(targetPath, { recursive: true });

      const result = analyzeTarget({
        targetPath: 'crates/engine/src',
        repoRoot: root,
      });

      const pkg = result.placements.find((p) => p.type === 'package');
      expect(pkg).toBeDefined();
      expect(pkg!.skillsDir).toBe(path.join(root, 'crates', 'engine', '.claude', 'skills'));
    });
  });

  test('detects go.mod as package boundary', () => {
    withTempRepo((root) => {
      const goPath = path.join(root, 'services', 'api');
      fs.mkdirSync(goPath, { recursive: true });
      fs.writeFileSync(path.join(goPath, 'go.mod'), 'module api');

      const targetPath = path.join(goPath, 'handlers');
      fs.mkdirSync(targetPath, { recursive: true });

      const result = analyzeTarget({
        targetPath: 'services/api/handlers',
        repoRoot: root,
      });

      const pkg = result.placements.find((p) => p.type === 'package');
      expect(pkg).toBeDefined();
      expect(pkg!.skillsDir).toBe(path.join(root, 'services', 'api', '.claude', 'skills'));
    });
  });

  test('detects pyproject.toml as package boundary', () => {
    withTempRepo((root) => {
      const pyPath = path.join(root, 'packages', 'ml');
      fs.mkdirSync(pyPath, { recursive: true });
      fs.writeFileSync(path.join(pyPath, 'pyproject.toml'), '[tool.poetry]');

      const targetPath = path.join(pyPath, 'models');
      fs.mkdirSync(targetPath, { recursive: true });

      const result = analyzeTarget({
        targetPath: 'packages/ml/models',
        repoRoot: root,
      });

      const pkg = result.placements.find((p) => p.type === 'package');
      expect(pkg).toBeDefined();
      expect(pkg!.skillsDir).toBe(path.join(root, 'packages', 'ml', '.claude', 'skills'));
    });
  });

  test('does not escape repo root when target is repo root', () => {
    withTempRepo((root) => {
      fs.writeFileSync(path.join(root, 'README.md'), 'readme');

      const result = analyzeTarget({
        targetPath: '.',
        repoRoot: root,
      });

      // Boundary files should be empty (no parent to sample from)
      expect(result.boundaryFiles).toEqual([]);
      // Directory tree should be simple
      expect(result.directoryTree).toBe('.  ← target');
      // Globs should NOT have ./ prefix
      expect(result.suggestedGlobs.every((g) => !g.startsWith('./'))).toBe(true);
    });
  });
});

// --- resolveTargetDirectory ---

describe('resolveTargetDirectory', () => {
  test('resolves exact basename match when path does not exist', () => {
    withTempRepo((root) => {
      // Create packages/cli/src/tui
      const tuiPath = path.join(root, 'packages', 'cli', 'src', 'tui');
      fs.mkdirSync(tuiPath, { recursive: true });
      fs.writeFileSync(path.join(tuiPath, 'app.tsx'), 'code');

      // User types "tui" — should find packages/cli/src/tui
      const resolved = resolveTargetDirectory('tui', root);
      expect(resolved).toBe(tuiPath);
    });
  });

  test('resolves typo in path segments via fuzzy matching', () => {
    withTempRepo((root) => {
      // Create packages/cli/src/tui
      const tuiPath = path.join(root, 'packages', 'cli', 'src', 'tui');
      fs.mkdirSync(tuiPath, { recursive: true });
      fs.writeFileSync(path.join(tuiPath, 'app.tsx'), 'code');

      // User types "pacakges/tui" — basename "tui" matches exactly
      const resolved = resolveTargetDirectory('pacakges/tui', root);
      expect(resolved).toBe(tuiPath);
    });
  });

  test('resolves typo in basename via levenshtein', () => {
    withTempRepo((root) => {
      // Create src/components
      const compPath = path.join(root, 'src', 'components');
      fs.mkdirSync(compPath, { recursive: true });

      // User types "src/compnents" (typo) — fuzzy match finds "components"
      const resolved = resolveTargetDirectory('src/compnents', root);
      expect(resolved).toBe(compPath);
    });
  });

  test('picks closest path when multiple dirs share same basename', () => {
    withTempRepo((root) => {
      // Create two "lib" directories at different paths
      const cliLib = path.join(root, 'packages', 'cli', 'src', 'lib');
      const coreLib = path.join(root, 'packages', 'core', 'src', 'lib');
      fs.mkdirSync(cliLib, { recursive: true });
      fs.mkdirSync(coreLib, { recursive: true });

      // User types "packages/core/src/lib" — should match the core one
      const resolved = resolveTargetDirectory('packages/core/src/lib', root);
      expect(resolved).toBe(coreLib);

      // User types "packages/cli/src/lib" — should match the cli one
      const resolved2 = resolveTargetDirectory('packages/cli/src/lib', root);
      expect(resolved2).toBe(cliLib);
    });
  });

  test('returns exact path when it exists', () => {
    withTempRepo((root) => {
      const srcPath = path.join(root, 'src');
      fs.mkdirSync(srcPath, { recursive: true });

      const resolved = resolveTargetDirectory('src', root);
      expect(resolved).toBe(srcPath);
    });
  });

  test('resolves file path to parent directory', () => {
    withTempRepo((root) => {
      const srcPath = path.join(root, 'src');
      fs.mkdirSync(srcPath, { recursive: true });
      fs.writeFileSync(path.join(srcPath, 'app.ts'), 'code');

      const resolved = resolveTargetDirectory('src/app.ts', root);
      expect(resolved).toBe(srcPath);
    });
  });

  test('throws for completely unresolvable path', () => {
    withTempRepo((root) => {
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });

      expect(() => resolveTargetDirectory('zzzznotreal', root)).toThrow('Could not find directory matching');
    });
  });

  test('analyzeTarget uses resolved path for globs', () => {
    withTempRepo((root) => {
      // Create packages/cli/src/tui with a TS file
      const tuiPath = path.join(root, 'packages', 'cli', 'src', 'tui');
      fs.mkdirSync(tuiPath, { recursive: true });
      fs.writeFileSync(path.join(tuiPath, 'app.tsx'), 'code');

      // User types "pacakges/tui" (typo) — globs should use correct resolved path
      const result = analyzeTarget({ targetPath: 'pacakges/tui', repoRoot: root });

      expect(result.relativePath).toBe(path.join('packages', 'cli', 'src', 'tui'));
      expect(result.suggestedGlobs.some((g) => g.includes('packages/cli/src/tui'))).toBe(true);
      expect(result.files.length).toBeGreaterThan(0);
    });
  });
});
