/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createSaguaroMcpServer } from './server.js';

async function createTestClient() {
  const mcpServer = createSaguaroMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await mcpServer.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  return { client, mcpServer };
}

describe('MCP server', () => {
  test('lists all expected tools', async () => {
    const { client } = await createTestClient();
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name).sort();

    expect(toolNames).toEqual([
      'saguaro_create_rule',
      'saguaro_delete_rule',
      'saguaro_generate_rule',
      'saguaro_generate_rules',
      'saguaro_get_generated_rule_details',
      'saguaro_get_models',
      'saguaro_review',
      'saguaro_set_model',
      'saguaro_validate_rules',
      'saguaro_write_accepted_rules',
    ]);
  });
});
