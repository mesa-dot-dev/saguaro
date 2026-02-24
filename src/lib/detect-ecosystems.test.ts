/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { anyFileMatchesGlob, detectEcosystems, readPackageDeps, readPythonDeps } from './detect-ecosystems.js';

function withTempDir(run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-detect-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ── readPackageDeps ─────────────────────────────────────────────────

describe('readPackageDeps', () => {
  test('returns empty set when package.json is missing', () => {
    withTempDir((root) => {
      expect(readPackageDeps(root).size).toBe(0);
    });
  });

  test('extracts deps from dependencies, devDependencies, and peerDependencies', () => {
    withTempDir((root) => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
          devDependencies: { prisma: '^5.0.0', typescript: '^5.0.0' },
          peerDependencies: { zod: '^3.0.0' },
        })
      );

      const deps = readPackageDeps(root);
      expect(deps.has('react')).toBe(true);
      expect(deps.has('react-dom')).toBe(true);
      expect(deps.has('prisma')).toBe(true);
      expect(deps.has('typescript')).toBe(true);
      expect(deps.has('zod')).toBe(true);
      expect(deps.size).toBe(5);
    });
  });

  test('returns empty set for malformed JSON', () => {
    withTempDir((root) => {
      fs.writeFileSync(path.join(root, 'package.json'), '{ not valid json');
      expect(readPackageDeps(root).size).toBe(0);
    });
  });
});

// ── readPythonDeps ──────────────────────────────────────────────────

describe('readPythonDeps', () => {
  test('reads deps from requirements.txt stripping version specifiers', () => {
    withTempDir((root) => {
      fs.writeFileSync(
        path.join(root, 'requirements.txt'),
        ['django>=4.0', 'fastapi', 'pydantic~=2.0', '# comment', '', '-r other.txt'].join('\n')
      );

      const deps = readPythonDeps(root);
      expect(deps.has('django')).toBe(true);
      expect(deps.has('fastapi')).toBe(true);
      expect(deps.has('pydantic')).toBe(true);
      expect(deps.size).toBe(3);
    });
  });

  test('reads deps from pyproject.toml', () => {
    withTempDir((root) => {
      fs.writeFileSync(
        path.join(root, 'pyproject.toml'),
        ['[project]', 'dependencies = [', '  "django>=4.0",', '  "celery",', ']'].join('\n')
      );

      const deps = readPythonDeps(root);
      expect(deps.has('django')).toBe(true);
      expect(deps.has('celery')).toBe(true);
    });
  });
});

// ── anyFileMatchesGlob ──────────────────────────────────────────────

describe('anyFileMatchesGlob', () => {
  test('matches a file in the root directory', () => {
    withTempDir((root) => {
      fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
      expect(anyFileMatchesGlob(root, ['tsconfig.json'])).toBe(true);
    });
  });

  test('matches a file in a nested directory', () => {
    withTempDir((root) => {
      fs.mkdirSync(path.join(root, 'prisma'), { recursive: true });
      fs.writeFileSync(path.join(root, 'prisma', 'schema.prisma'), '');
      expect(anyFileMatchesGlob(root, ['prisma/schema.prisma'])).toBe(true);
    });
  });

  test('matches wildcard globs', () => {
    withTempDir((root) => {
      fs.mkdirSync(path.join(root, 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(root, 'migrations', '001.sql'), '');
      expect(anyFileMatchesGlob(root, ['**/migrations/**/*.sql'])).toBe(true);
    });
  });

  test('skips node_modules', () => {
    withTempDir((root) => {
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules', 'tsconfig.json'), '{}');
      expect(anyFileMatchesGlob(root, ['**/tsconfig.json'])).toBe(false);
    });
  });

  test('returns false for no matches', () => {
    withTempDir((root) => {
      expect(anyFileMatchesGlob(root, ['Cargo.toml'])).toBe(false);
    });
  });
});

// ── detectEcosystems ────────────────────────────────────────────────

describe('detectEcosystems', () => {
  test('detects typescript from tsconfig.json', () => {
    withTempDir((root) => {
      fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
      const result = detectEcosystems(root);
      expect(result.has('typescript')).toBe(true);
    });
  });

  test('detects react from package.json deps', () => {
    withTempDir((root) => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' } })
      );
      const result = detectEcosystems(root);
      expect(result.has('react')).toBe(true);
    });
  });

  test('detects go from go.mod', () => {
    withTempDir((root) => {
      fs.writeFileSync(path.join(root, 'go.mod'), 'module example.com/app\n\ngo 1.21\n');
      const result = detectEcosystems(root);
      expect(result.has('go')).toBe(true);
    });
  });

  test('detects python from pyproject.toml', () => {
    withTempDir((root) => {
      fs.writeFileSync(
        path.join(root, 'pyproject.toml'),
        ['[project]', 'name = "myapp"', 'dependencies = ["flask"]'].join('\n')
      );
      const result = detectEcosystems(root);
      expect(result.has('python')).toBe(true);
    });
  });

  test('returns empty set for empty directory', () => {
    withTempDir((root) => {
      const result = detectEcosystems(root);
      expect(result.size).toBe(0);
    });
  });

  test('detects multiple ecosystems from a full-stack project', () => {
    withTempDir((root) => {
      // tsconfig.json => typescript
      fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');

      // package.json with react => react, javascript
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
        })
      );

      // migrations/*.sql => sql
      fs.mkdirSync(path.join(root, 'migrations'), { recursive: true });
      fs.writeFileSync(path.join(root, 'migrations', '001_init.sql'), 'CREATE TABLE users;');

      const result = detectEcosystems(root);
      expect(result.has('typescript')).toBe(true);
      expect(result.has('javascript')).toBe(true);
      expect(result.has('react')).toBe(true);
      expect(result.has('sql')).toBe(true);
    });
  });

  test('reads deps from devDependencies', () => {
    withTempDir((root) => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({
          devDependencies: { express: '^4.0.0' },
        })
      );
      const result = detectEcosystems(root);
      expect(result.has('node')).toBe(true);
      expect(result.has('javascript')).toBe(true);
    });
  });
});
