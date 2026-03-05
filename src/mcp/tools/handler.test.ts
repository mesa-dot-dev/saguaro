/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRuleAdapter } from '../../adapter/rules.js';
import { createMesaMcpServer } from '../server.js';

async function withTempRepo(run: (root: string) => Promise<void>): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-mcp-handler-'));
  const originalCwd = process.cwd();
  try {
    fs.mkdirSync(path.join(root, '.git'));
    process.chdir(root);
    await run(root);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function createTestClient() {
  const server = createMesaMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, server };
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

function parseContent(result: Awaited<ReturnType<typeof callTool>>): unknown {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0].text);
}

function textContent(result: Awaited<ReturnType<typeof callTool>>): string {
  const content = result.content as { type: string; text: string }[];
  return content[0].text;
}

describe('mesa_validate_rules', () => {
  test('returns empty validated list when no rules directory exists', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_validate_rules');
      const data = parseContent(result) as { valid: boolean; validated: string[]; errors: unknown[] };

      expect(result.isError).toBeFalsy();
      expect(data.validated).toEqual([]);
    });
  });

  test('returns valid=true with a valid rule', async () => {
    await withTempRepo(async (root) => {
      createRuleAdapter({
        title: 'Test Rule',
        severity: 'error',
        globs: ['**/*.ts'],
        instructions: 'Test instructions',
        repoRoot: root,
        id: 'test-rule',
      });

      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_validate_rules');
      const data = parseContent(result) as { valid: boolean; validated: string[]; errors: unknown[] };

      expect(result.isError).toBeFalsy();
      expect(data.valid).toBe(true);
      expect(data.validated).toContain('test-rule');
      expect(data.errors).toEqual([]);
    });
  });
});

describe('mesa_create_rule', () => {
  test('creates a rule and returns id, title, path', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_create_rule', {
        title: 'No Any Type',
        severity: 'error',
        globs: ['**/*.ts'],
        instructions: 'Do not use the any type',
      });
      const text = textContent(result);

      expect(result.isError).toBeFalsy();
      expect(text).toContain('Rule created: no-any-type');
      expect(text).toContain('File: ');
      // Extract the file path from "File: /path/to/rule.md"
      const filePath = text.split('File: ')[1]?.trim();
      expect(filePath).toBeDefined();
      expect(fs.existsSync(filePath!)).toBe(true);
    });
  });

  test('returns error when required fields are missing', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_create_rule', {
        title: 'Missing Fields',
      });

      expect(result.isError).toBe(true);
    });
  });
});

describe('mesa_delete_rule', () => {
  test('deletes an existing rule', async () => {
    await withTempRepo(async (root) => {
      createRuleAdapter({
        title: 'To Delete',
        severity: 'info',
        globs: ['**/*.ts'],
        instructions: 'This will be deleted',
        repoRoot: root,
        id: 'to-delete',
      });

      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_delete_rule', { rule_id: 'to-delete' });
      const data = parseContent(result) as { deleted: boolean; id: string };

      expect(result.isError).toBeFalsy();
      expect(data.deleted).toBe(true);
      expect(data.id).toBe('to-delete');

      // Verify the rule file is gone
      const ruleFile = path.join(root, '.mesa', 'rules', 'to-delete.md');
      expect(fs.existsSync(ruleFile)).toBe(false);
    });
  });

  test('returns error for nonexistent rule', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_delete_rule', { rule_id: 'ghost-rule' });

      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain('Rule not found');
    });
  });
});

describe('mesa_get_generated_rule_details', () => {
  test('returns error when no rules have been generated', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_get_generated_rule_details', {
        rule_ids: ['some-rule'],
      });

      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain('No generated rules in session');
    });
  });

  test('returns error when called with no args and no session', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_get_generated_rule_details', {});

      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain('No generated rules in session');
    });
  });
});

describe('mesa_get_models', () => {
  test('returns providers and models', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_get_models', {});
      const data = parseContent(result) as { providers: unknown[]; current: unknown };

      expect(result.isError).toBeFalsy();
      expect(data.providers.length).toBeGreaterThanOrEqual(3);
      expect(data.current).toBeNull();
    });
  });

  test('returns current model when config exists', async () => {
    await withTempRepo(async (root) => {
      const mesaDir = path.join(root, '.mesa');
      fs.mkdirSync(mesaDir, { recursive: true });
      fs.writeFileSync(path.join(mesaDir, 'config.yaml'), 'model:\n  provider: anthropic\n  name: claude-opus-4-6\n');

      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_get_models', {});
      const data = parseContent(result) as { current: { provider: string; model: string } };

      expect(data.current).toEqual({ provider: 'anthropic', model: 'claude-opus-4-6' });
    });
  });

  test('filters by provider when specified', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_get_models', { provider: 'anthropic' });
      const data = parseContent(result) as { providers: { id: string }[] };

      expect(data.providers).toHaveLength(1);
      expect(data.providers[0].id).toBe('anthropic');
    });
  });
});

describe('mesa_set_model', () => {
  test('updates config with new provider and model', async () => {
    await withTempRepo(async (root) => {
      const mesaDir = path.join(root, '.mesa');
      fs.mkdirSync(mesaDir, { recursive: true });
      fs.writeFileSync(path.join(mesaDir, 'config.yaml'), 'model:\n  provider: anthropic\n  name: claude-opus-4-6\n');

      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_set_model', {
        provider: 'openai',
        model: 'gpt-5.2-codex',
      });
      const data = parseContent(result) as { success: boolean; provider: string; model: string };

      expect(result.isError).toBeFalsy();
      expect(data.success).toBe(true);
      expect(data.provider).toBe('openai');
      expect(data.model).toBe('gpt-5.2-codex');

      const config = fs.readFileSync(path.join(mesaDir, 'config.yaml'), 'utf8');
      expect(config).toContain('provider: openai');
      expect(config).toContain('name: gpt-5.2-codex');
    });
  });

  test('saves API key to .env.local when provided', async () => {
    await withTempRepo(async (root) => {
      const mesaDir = path.join(root, '.mesa');
      fs.mkdirSync(mesaDir, { recursive: true });
      fs.writeFileSync(path.join(mesaDir, 'config.yaml'), 'model:\n  provider: anthropic\n  name: claude-opus-4-6\n');

      const { client } = await createTestClient();
      await callTool(client, 'mesa_set_model', {
        provider: 'openai',
        model: 'gpt-5.2-codex',
        api_key: 'sk-test-key-123',
      });

      const envContent = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
      expect(envContent).toContain('OPENAI_API_KEY=sk-test-key-123');
    });
  });
});

describe('mesa_review', () => {
  test('returns error gracefully when called without proper git context', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_review', { base_branch: 'main' });

      // The review will fail because there is no real git history in the temp dir.
      // It should return an error result rather than crashing the server.
      const content = result.content as { type: string; text: string }[];
      expect(content).toHaveLength(1);
      expect(content[0].type).toBe('text');
      expect(typeof content[0].text).toBe('string');
    });
  });
});

describe('mesa_review mode parameter', () => {
  test('lists mode in mesa_review tool schema', async () => {
    const { client } = await createTestClient();
    const tools = await client.listTools();
    const reviewTool = tools.tools.find((t) => t.name === 'mesa_review');
    expect(reviewTool).toBeDefined();
    const schema = reviewTool!.inputSchema as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown>;
    expect(properties.mode).toBeDefined();
  });
});
