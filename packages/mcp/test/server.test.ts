import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createConduktorServer } from '../src/server';
import { fakeContext, resultText as text } from './fakeContext';

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createConduktorServer(fakeContext, '0.0.0-test').connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
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
      'conduktor_diff_with_live',
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

  it('offers prompts for the common tasks, filled in with their arguments', async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => [p.name, p.arguments?.map((a) => [a.name, a.required ?? false])])).toEqual([
      ['get_started', []],
      [
        'write_resource',
        [
          ['kind', true],
          ['what', false],
        ],
      ],
      ['review_changes', [['path', false]]],
    ]);
    const prompt = await client.getPrompt({
      name: 'write_resource',
      arguments: { kind: 'Topic', what: 'order events' },
    });
    const [message] = prompt.messages;
    expect(message?.role).toBe('user');
    const text = message?.content.type === 'text' ? message.content.text : '';
    expect(text).toMatch(/^Write a Conduktor Topic for this: order events\./);
    expect(text).toContain('conduktor_get_kind_schema for Topic');
  });

  it('refuses a prompt without its required arguments', async () => {
    const client = await connect();
    await expect(client.getPrompt({ name: 'write_resource', arguments: {} })).rejects.toThrow(/kind/);
    await expect(client.getPrompt({ name: 'nope' })).rejects.toThrow(/nope/);
  });
});
