/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMesaMcpServer } from './server.js';

async function createTestClient() {
  const mcpServer = createMesaMcpServer();
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
      'mesa_create_rule',
      'mesa_delete_rule',
      'mesa_generate_rule',
      'mesa_generate_rules',
      'mesa_get_generated_rule_details',
      'mesa_review',
      'mesa_sync_rules',
      'mesa_validate_rules',
      'mesa_write_accepted_rules',
    ]);
  });
});
