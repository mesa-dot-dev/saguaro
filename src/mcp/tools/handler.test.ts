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

describe('mesa_list_rules', () => {
  test('returns empty array when no rules exist', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_list_rules');
      const data = parseContent(result);

      expect(result.isError).toBeFalsy();
      expect(data).toEqual([]);
    });
  });

  test('returns rules after creating one', async () => {
    await withTempRepo(async (root) => {
      createRuleAdapter({
        title: 'No Console Log',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Do not use console.log',
        repoRoot: root,
      });

      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_list_rules');
      const data = parseContent(result) as { id: string; title: string; severity: string; tags: string[] }[];

      expect(result.isError).toBeFalsy();
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('no-console-log');
      expect(data[0].title).toBe('No Console Log');
      expect(data[0].severity).toBe('warning');
      expect(data[0].tags).toEqual([]);
    });
  });
});

describe('mesa_explain_rule', () => {
  test('returns error for nonexistent rule', async () => {
    await withTempRepo(async () => {
      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_explain_rule', { rule_id: 'does-not-exist' });

      expect(result.isError).toBe(true);
      expect(textContent(result)).toContain('Rule not found');
    });
  });

  test('returns full rule details for existing rule', async () => {
    await withTempRepo(async (root) => {
      createRuleAdapter({
        title: 'No Console Log',
        severity: 'warning',
        globs: ['**/*.ts'],
        instructions: 'Do not use console.log',
        repoRoot: root,
        id: 'no-console-log',
      });

      const { client } = await createTestClient();
      const result = await callTool(client, 'mesa_explain_rule', { rule_id: 'no-console-log' });
      const data = parseContent(result) as Record<string, unknown>;

      expect(result.isError).toBeFalsy();
      expect(data.id).toBe('no-console-log');
      expect(data.title).toBe('No Console Log');
      expect(data.severity).toBe('warning');
      expect(data.globs).toEqual(['**/*.ts']);
      expect(data.instructions).toBe('Do not use console.log');
    });
  });
});

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
      const data = parseContent(result) as { id: string; title: string; path: string };

      expect(result.isError).toBeFalsy();
      expect(data.id).toBe('no-any-type');
      expect(data.title).toBe('No Any Type');
      expect(typeof data.path).toBe('string');
      expect(fs.existsSync(data.path)).toBe(true);
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

      // Verify the rule is gone
      const listResult = await callTool(client, 'mesa_list_rules');
      const rules = parseContent(listResult) as unknown[];
      expect(rules).toEqual([]);
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
