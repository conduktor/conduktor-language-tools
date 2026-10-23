import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Telemetry, type TelemetrySink } from '@conduktor/core';
import { describe, expect, it } from 'vitest';
import { createConduktorServer } from '../src/server';
import { fakeContext, resultText as text } from './fakeContext';

async function connect(telemetry?: Telemetry, clientInfo = { name: 'test', version: '0' }) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createConduktorServer(fakeContext, '0.0.0-test', telemetry).connect(serverSide);
  const client = new Client(clientInfo);
  await client.connect(clientSide);
  return client;
}

describe('Conduktor MCP server', () => {
  it('lists the core tools with their input schemas and tells agents the workflow', async () => {
    const client = await connect();
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
    const client = await connect();
    const result = await client.callTool({
      name: 'conduktor_validate',
      arguments: { yaml: 'apiVersion: v2\nkind: Topic\nmetadata: { name: t, cluster: c }\nspec: { partitions: x }\n' },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toHaveProperty(
      ['documents', 0, 'errors'],
      expect.arrayContaining([expect.objectContaining({ path: '/spec/partitions' })]),
    );
  });

  it('reports tool errors as errors the agent can read', async () => {
    const client = await connect();
    const result = await client.callTool({ name: 'conduktor_dry_run', arguments: { yaml: 'kind: Topic' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/No Conduktor resources found/);
    expect((await client.callTool({ name: 'nope', arguments: {} })).isError).toBe(true);
  });

  it('reports the agent it serves and the tools it calls, not their arguments', async () => {
    const sent: { event: string; properties: Record<string, unknown> }[] = [];
    const sink: TelemetrySink = {
      send: (event, properties) => sent.push({ event, properties }),
      flush: () => Promise.resolve(),
    };
    const telemetry = new Telemetry(sink, { surface: 'mcp', client: 'other', extensionVersion: '0.0.0-test' });
    const client = await connect(telemetry, { name: 'claude-code', version: '2.1.0' });
    await client.callTool({
      name: 'conduktor_validate',
      arguments: { yaml: 'apiVersion: v2\nkind: Topic\nmetadata: { name: private-name, cluster: c }\nspec: {}\n' },
    });
    await client.callTool({ name: 'conduktor_dry_run', arguments: { yaml: 'kind: Topic' } });
    await client.callTool({ name: 'made_up', arguments: {} });

    expect(sent.map((s) => [s.event, s.properties.tool, s.properties.result])).toEqual([
      ['cdk.extension.Started', undefined, undefined],
      ['cdk.extension.tool.Called', 'conduktor_validate', 'success'],
      ['cdk.extension.tool.Called', 'conduktor_dry_run', 'failure'],
      ['cdk.extension.tool.Called', 'other', 'failure'],
    ]);
    expect(sent[0]?.properties).toMatchObject({ surface: 'mcp', client: 'claude-code', clientVersion: '2.1.0' });
    expect(JSON.stringify(sent)).not.toContain('private-name');
  });
});
