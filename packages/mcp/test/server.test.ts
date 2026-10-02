import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ToolContext } from '@conduktor/vscode-core';
import { describe, expect, it } from 'vitest';
import { createConduktorServer } from '../src/server';
import { fakeContext } from './fakeContext';

async function connect(context: ToolContext) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createConduktorServer(() => context, '0.0.0-test').connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

const text = (result: Awaited<ReturnType<Client['callTool']>>) =>
  (result.content as { type: string; text: string }[]).map((part) => part.text).join('');

describe('Conduktor MCP server', () => {
  it('lists the core tools with their input schemas and tells agents the workflow', async () => {
    const client = await connect(fakeContext());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([
      'conduktor_list_kinds',
      'conduktor_get_kind_schema',
      'conduktor_validate',
      'conduktor_dry_run',
      'conduktor_get_resources',
    ]);
    expect(tools.find((t) => t.name === 'conduktor_get_kind_schema')?.inputSchema.required).toEqual(['kind']);
    expect(client.getInstructions()).toMatch(/never say it has been applied/);
  });

  it('runs a tool and returns its text', async () => {
    const client = await connect(fakeContext());
    const result = await client.callTool({
      name: 'conduktor_validate',
      arguments: { yaml: 'apiVersion: v2\nkind: Topic\nmetadata: { name: t, cluster: c }\nspec: { partitions: x }\n' },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result)).documents[0].errors).toContainEqual(
      expect.objectContaining({ path: '/spec/partitions' }),
    );
  });

  it('reports tool errors as errors the agent can read', async () => {
    const client = await connect(fakeContext({ mode: 'read-only' }));
    const result = await client.callTool({ name: 'conduktor_dry_run', arguments: { yaml: 'kind: Topic' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/read-only/);
    expect((await client.callTool({ name: 'nope', arguments: {} })).isError).toBe(true);
  });
});
