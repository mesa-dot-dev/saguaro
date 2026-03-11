/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { getCurrentModel, getModelCatalog, getProviderCatalog, setModel } from './catalog.js';
import { upsertEnvValue } from './env.js';

function withTempRepo(run: (root: string) => void | Promise<void>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saguaro-catalog-'));
  const originalCwd = process.cwd();
  try {
    fs.mkdirSync(path.join(root, '.git'));
    process.chdir(root);
    return run(root);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// getModelCatalog (catalog shape)
// ---------------------------------------------------------------------------

describe('getModelCatalog (catalog shape)', () => {
  test('includes anthropic, openai, and google providers', async () => {
    const catalog = await getModelCatalog();
    const ids = catalog.map((p) => p.id);
    expect(ids).toContain('anthropic');
    expect(ids).toContain('openai');
    expect(ids).toContain('google');
  });

  test('each provider has at least one model', async () => {
    const catalog = await getModelCatalog();
    for (const provider of catalog) {
      expect(provider.models.length).toBeGreaterThanOrEqual(1);
    }
  });

  test('each provider has a non-empty envKey', async () => {
    const catalog = await getModelCatalog();
    for (const provider of catalog) {
      expect(provider.envKey.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// getModelCatalog
// ---------------------------------------------------------------------------

describe('getModelCatalog', () => {
  test('returns at least 3 providers', async () => {
    const catalog = await getModelCatalog();
    expect(catalog.length).toBeGreaterThanOrEqual(3);
  });

  test('returns providers with models', async () => {
    const catalog = await getModelCatalog();
    for (const provider of catalog) {
      expect(provider.models.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// getProviderCatalog
// ---------------------------------------------------------------------------

describe('getProviderCatalog', () => {
  test('returns models for a specific provider', async () => {
    const anthropic = await getProviderCatalog('anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.id).toBe('anthropic');
    expect(anthropic!.models.length).toBeGreaterThanOrEqual(1);
  });

  test('returns undefined for unknown provider', async () => {
    const result = await getProviderCatalog('nonexistent' as never);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getCurrentModel
// ---------------------------------------------------------------------------

describe('getCurrentModel', () => {
  test('returns null when no config exists', () => {
    withTempRepo(() => {
      const result = getCurrentModel();
      expect(result).toBeNull();
    });
  });

  test('returns current model from config', () => {
    withTempRepo((root) => {
      const saguaroDir = path.join(root, '.saguaro');
      fs.mkdirSync(saguaroDir, { recursive: true });
      fs.writeFileSync(
        path.join(saguaroDir, 'config.yaml'),
        yaml.dump({
          model: { provider: 'openai', name: 'gpt-5.2-codex' },
          review: { max_steps: 10, files_per_batch: 2 },
        })
      );

      const result = getCurrentModel();
      expect(result).toEqual({ provider: 'openai', model: 'gpt-5.2-codex' });
    });
  });

  test('returns null when config has no model section', () => {
    withTempRepo((root) => {
      const saguaroDir = path.join(root, '.saguaro');
      fs.mkdirSync(saguaroDir, { recursive: true });
      fs.writeFileSync(path.join(saguaroDir, 'config.yaml'), yaml.dump({ review: { max_steps: 10 } }));

      const result = getCurrentModel();
      expect(result).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// setModel
// ---------------------------------------------------------------------------

describe('setModel', () => {
  test('creates config when none exists', () => {
    withTempRepo((root) => {
      setModel('anthropic', 'claude-opus-4-6');

      const configPath = path.join(root, '.saguaro', 'config.yaml');
      expect(fs.existsSync(configPath)).toBe(true);

      const parsed = yaml.load(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
      const model = parsed.model as { provider: string; name: string };
      expect(model.provider).toBe('anthropic');
      expect(model.name).toBe('claude-opus-4-6');
    });
  });

  test('updates config preserving other fields and comments', () => {
    withTempRepo((root) => {
      const saguaroDir = path.join(root, '.saguaro');
      fs.mkdirSync(saguaroDir, { recursive: true });
      const configPath = path.join(saguaroDir, 'config.yaml');
      const original = [
        '# Saguaro Configuration',
        'model:',
        '  provider: anthropic',
        '  name: claude-opus-4-6',
        '',
        '# Review settings',
        'review:',
        '  max_steps: 10',
        '',
      ].join('\n');
      fs.writeFileSync(configPath, original);

      setModel('openai', 'gpt-5.2-codex');

      const raw = fs.readFileSync(configPath, 'utf8');

      // Comments must survive
      expect(raw).toContain('# Saguaro Configuration');
      expect(raw).toContain('# Review settings');

      // Values must be updated
      const parsed = yaml.load(raw) as Record<string, unknown>;
      const model = parsed.model as { provider: string; name: string };
      expect(model.provider).toBe('openai');
      expect(model.name).toBe('gpt-5.2-codex');

      // Other sections must be preserved
      const review = parsed.review as { max_steps: number };
      expect(review.max_steps).toBe(10);
    });
  });

  test('saves API key to .env.local when provided', () => {
    withTempRepo((root) => {
      const saguaroDir = path.join(root, '.saguaro');
      fs.mkdirSync(saguaroDir, { recursive: true });
      fs.writeFileSync(
        path.join(saguaroDir, 'config.yaml'),
        yaml.dump({ model: { provider: 'anthropic', name: 'claude-opus-4-6' } })
      );

      setModel('openai', 'gpt-5.2-codex', { apiKey: 'sk-test-key-123' });

      const envPath = path.join(root, '.env.local');
      expect(fs.existsSync(envPath)).toBe(true);

      const envContent = fs.readFileSync(envPath, 'utf8');
      expect(envContent).toContain('OPENAI_API_KEY=sk-test-key-123');
    });
  });
});

// ---------------------------------------------------------------------------
// upsertEnvValue
// ---------------------------------------------------------------------------

describe('upsertEnvValue', () => {
  test('creates file and writes key when file does not exist', () => {
    withTempRepo((root) => {
      const envPath = path.join(root, '.env.test');
      upsertEnvValue(envPath, 'MY_KEY', 'my-value');

      const content = fs.readFileSync(envPath, 'utf8');
      expect(content).toBe('MY_KEY=my-value\n');
    });
  });

  test('appends key when file exists without the key', () => {
    withTempRepo((root) => {
      const envPath = path.join(root, '.env.test');
      fs.writeFileSync(envPath, 'EXISTING_KEY=existing-value\n');

      upsertEnvValue(envPath, 'NEW_KEY', 'new-value');

      const content = fs.readFileSync(envPath, 'utf8');
      expect(content).toContain('EXISTING_KEY=existing-value');
      expect(content).toContain('NEW_KEY=new-value');
    });
  });

  test('replaces key when file already contains the key', () => {
    withTempRepo((root) => {
      const envPath = path.join(root, '.env.test');
      fs.writeFileSync(envPath, 'MY_KEY=old-value\nOTHER_KEY=other\n');

      upsertEnvValue(envPath, 'MY_KEY', 'updated-value');

      const content = fs.readFileSync(envPath, 'utf8');
      expect(content).toContain('MY_KEY=updated-value');
      expect(content).toContain('OTHER_KEY=other');
      // Should not have duplicate entries
      expect(content.match(/MY_KEY=/g)?.length).toBe(1);
    });
  });

  test('strips newlines from values', () => {
    withTempRepo((root) => {
      const envPath = path.join(root, '.env.test');
      upsertEnvValue(envPath, 'MY_KEY', 'value-with\nnewline');

      const content = fs.readFileSync(envPath, 'utf8');
      expect(content).toBe('MY_KEY=value-withnewline\n');
    });
  });
});
