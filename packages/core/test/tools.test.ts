import Ajv from 'ajv';
import { describe, expect, it, vi } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { conduktorTools, ToolError, type ToolContext } from '../src/tools';
import type { Resource } from '../src/resources/types';
import { snapshotCatalog, snapshotDoc } from './fixtures';

const schema = buildResourceSchema(snapshotDoc, snapshotCatalog);

function context(overrides: Partial<ToolContext> = {}) {
  const client = {
    list: vi.fn(async (_path: string): Promise<Resource[]> => []),
    get: vi.fn(async (_path: string): Promise<Resource> => ({
      apiVersion: 'v2',
      kind: 'Topic',
      metadata: { name: 'x' },
    })),
    upsert: vi.fn(async (_target: unknown, resource: Resource, _options: { dryRun: boolean }) => ({
      resource,
      upsertResult: 'Created' as const,
    })),
  };
  const ctx: ToolContext = {
    connectionName: 'local',
    mode: 'dry-run',
    catalog: snapshotCatalog,
    schema,
    client,
    env: {},
    ...overrides,
  };
  return { ctx, client };
}

const tool = (name: string) => {
  const found = conduktorTools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
};

const topic = (spec: string, metadata = '{ name: orders, cluster: local }') =>
  `apiVersion: v2\nkind: Topic\nmetadata: ${metadata}\nspec: ${spec}\n`;

describe('conduktor tools', () => {
  it('each has a name, a description that states the workflow, and an object input schema', () => {
    expect(conduktorTools.map((t) => t.name)).toEqual([
      'conduktor_list_kinds',
      'conduktor_get_kind_schema',
      'conduktor_validate',
      'conduktor_dry_run',
      'conduktor_get_resources',
    ]);
    for (const t of conduktorTools) {
      expect(t.inputSchema.type).toBe('object');
      expect(t.description.length).toBeGreaterThan(40);
    }
    expect(tool('conduktor_dry_run').description).toMatch(/does not change|never changes|nothing is applied/i);
  });
});

describe('conduktor_list_kinds', () => {
  it('lists kinds in apply order with their versions and parents', async () => {
    const { ctx } = context();
    const result = JSON.parse(await tool('conduktor_list_kinds').run({}, ctx));
    expect(result.console).toBe('local');
    expect(result.kinds[0].kind).toBe('User');
    expect(result.kinds).toContainEqual(
      expect.objectContaining({ kind: 'Topic', apiVersions: ['v2'], group: 'kafka', parents: ['cluster'] }),
    );
    expect(result.kinds.find((k: { kind: string }) => k.kind === 'Alert').apiVersions).toEqual(['v2', 'v3']);
  });
});

describe('conduktor_get_kind_schema', () => {
  it('returns the kind schema, which accepts its own example, and the example YAML', async () => {
    const { ctx } = context();
    const text = await tool('conduktor_get_kind_schema').run({ kind: 'Topic' }, ctx);
    const json = /```json\n([\s\S]*?)\n```/.exec(text)?.[1];
    const yaml = /```yaml\n([\s\S]*?)\n```/.exec(text)?.[1];
    expect(json && yaml).toBeTruthy();
    const kindSchema = JSON.parse(json!);
    expect(Object.keys(kindSchema.definitions)).toContain('TopicResourceV2');
    expect(Object.keys(kindSchema.definitions)).not.toContain('KafkaClusterResourceV2');
    const validate = new Ajv({ strict: false, validateFormats: false }).compile(kindSchema);
    expect(validate(parseAllDocuments(yaml!)[0]!.toJS())).toBe(true);
  });

  it('suggests the right kind for a near miss', async () => {
    const { ctx } = context();
    await expect(tool('conduktor_get_kind_schema').run({ kind: 'topic' }, ctx)).rejects.toThrow(
      new ToolError('Unknown kind "topic". Did you mean Topic? conduktor_list_kinds lists them all.'),
    );
  });

  it('names the versions a kind has', async () => {
    const { ctx } = context();
    await expect(tool('conduktor_get_kind_schema').run({ kind: 'Topic', apiVersion: 'v9' }, ctx)).rejects.toThrow(
      'Topic has no v9 on local; it has v2.',
    );
  });
});

describe('conduktor_validate', () => {
  it('reports schema errors with their JSON paths, document by document', async () => {
    const { ctx } = context();
    const yaml = [
      topic('{ partitions: three, replicationFactor: 1 }'),
      topic('{ partitions: 3, replicationFactor: 1 }', '{ name: ok, cluster: local }'),
    ].join('---\n');
    const result = JSON.parse(await tool('conduktor_validate').run({ yaml }, ctx));
    expect(result.documents[0]).toMatchObject({ index: 0, kind: 'Topic', name: 'orders', valid: false });
    expect(result.documents[0].errors).toContainEqual(expect.objectContaining({ path: '/spec/partitions' }));
    expect(result.documents[1]).toMatchObject({ name: 'ok', valid: true, errors: [] });
  });

  it('names a missing required field', async () => {
    const { ctx } = context();
    const result = JSON.parse(
      await tool('conduktor_validate').run({ yaml: topic('{ partitions: 1 }', '{ name: orders }') }, ctx),
    );
    expect(result.documents[0].errors).toContainEqual({
      path: '/metadata',
      message: "must have required property 'cluster'",
    });
  });

  it('says which versions exist when the apiVersion is wrong', async () => {
    const { ctx } = context();
    const result = JSON.parse(await tool('conduktor_validate').run({ yaml: topic('{}').replace('v2', 'v9') }, ctx));
    expect(result.documents[0]).toMatchObject({
      valid: false,
      errors: [{ path: '/apiVersion', message: 'Topic has no v9 on local; it has v2.' }],
    });
  });

  it('reads a file when given a path', async () => {
    const readFile = vi.fn(() => topic('{ partitions: 1, replicationFactor: 1 }'));
    const { ctx } = context({ readFile });
    const result = JSON.parse(await tool('conduktor_validate').run({ path: 'topics/orders.yaml' }, ctx));
    expect(readFile).toHaveBeenCalledWith('topics/orders.yaml');
    expect(result.documents[0].valid).toBe(true);
  });

  it('asks for exactly one of yaml or path', async () => {
    const { ctx } = context();
    await expect(tool('conduktor_validate').run({}, ctx)).rejects.toThrow(ToolError);
    await expect(tool('conduktor_validate').run({ yaml: 'a: 1', path: 'x' }, ctx)).rejects.toThrow(ToolError);
  });

  it('says when there is nothing to validate', async () => {
    const { ctx } = context();
    await expect(
      tool('conduktor_validate').run({ yaml: 'apiVersion: v1\nkind: ConfigMap\nmetadata: { name: c }\n' }, ctx),
    ).rejects.toThrow('No Conduktor resources found');
  });
});

describe('conduktor_dry_run', () => {
  it('dry-runs every document and says nothing was changed', async () => {
    const { ctx, client } = context();
    const result = JSON.parse(
      await tool('conduktor_dry_run').run({ yaml: topic('{ partitions: 1, replicationFactor: 1 }') }, ctx),
    );
    expect(client.upsert).toHaveBeenCalledWith(
      { path: '/public/kafka/v2/cluster/local/topic', query: {} },
      expect.objectContaining({ kind: 'Topic' }),
      { dryRun: true },
    );
    expect(result).toMatchObject({
      console: 'local',
      documents: [{ index: 0, kind: 'Topic', name: 'orders', result: 'Created' }],
    });
    expect(result.note).toMatch(/nothing was changed/i);
  });

  it('refuses on a read-only connection', async () => {
    const { ctx, client } = context({ mode: 'read-only' });
    await expect(tool('conduktor_dry_run').run({ yaml: topic('{}') }, ctx)).rejects.toThrow(/read-only/);
    expect(client.upsert).not.toHaveBeenCalled();
  });
});

describe('conduktor_get_resources', () => {
  it('lists a kind under its parents as YAML', async () => {
    const { ctx, client } = context();
    client.list.mockResolvedValueOnce([
      { apiVersion: 'v2', kind: 'Topic', metadata: { name: 'a', cluster: 'local' } },
      { apiVersion: 'v2', kind: 'Topic', metadata: { name: 'b', cluster: 'local' } },
    ]);
    const text = await tool('conduktor_get_resources').run({ kind: 'Topic', cluster: 'local' }, ctx);
    expect(client.list).toHaveBeenCalledWith('/public/kafka/v2/cluster/local/topic');
    expect(parseAllDocuments(text).map((d) => d.toJS().metadata.name)).toEqual(['a', 'b']);
  });

  it('gets one resource by name', async () => {
    const { ctx, client } = context();
    await tool('conduktor_get_resources').run({ kind: 'Topic', cluster: 'local', name: 'orders' }, ctx);
    expect(client.get).toHaveBeenCalledWith('/public/kafka/v2/cluster/local/topic/orders');
  });

  it('asks for the parents a kind needs', async () => {
    const { ctx } = context();
    await expect(tool('conduktor_get_resources').run({ kind: 'Topic' }, ctx)).rejects.toThrow(
      'Topic needs cluster. conduktor_get_resources with kind KafkaCluster lists the clusters.',
    );
  });
});
