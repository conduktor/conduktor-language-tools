import Ajv from 'ajv';
import { assert, describe, expect, it, vi } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { ConsoleError } from '../src/client/errors';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { conduktorTools, ToolError, type ToolContext } from '../src/tools';
import type { Resource } from '../src/resources/types';
import { isRecord } from '../src/util';
import { at, snapshotCatalog, snapshotDoc } from './fixtures';

const schema = buildResourceSchema(snapshotDoc, snapshotCatalog);

function context(overrides: Partial<ToolContext> = {}) {
  const client = {
    list: vi.fn((_path: string): Promise<Resource[]> => Promise.resolve([])),
    get: vi.fn((_path: string): Promise<Resource> =>
      Promise.resolve({ apiVersion: 'v2', kind: 'Topic', metadata: { name: 'x' } }),
    ),
    upsert: vi.fn((_target: unknown, resource: Resource, _options: { dryRun: boolean }) =>
      Promise.resolve({ resource, upsertResult: 'Created' as const }),
    ),
  };
  const ctx: ToolContext = {
    connectionName: 'local',
    catalog: snapshotCatalog,
    schema,
    client,
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
    const result: unknown = JSON.parse(await tool('conduktor_list_kinds').run({}, ctx));
    expect(at(result, 'console')).toBe('local');
    expect(at(result, 'kinds', 0, 'kind')).toBe('User');
    expect(at(result, 'kinds')).toContainEqual(
      expect.objectContaining({ kind: 'Topic', apiVersions: ['v2'], group: 'kafka', parents: ['cluster'] }),
    );
    expect(at(result, 'kinds')).toContainEqual(expect.objectContaining({ kind: 'Alert', apiVersions: ['v2', 'v3'] }));
  });
});

describe('conduktor_get_kind_schema', () => {
  it('returns the kind schema, which accepts its own example, and the example YAML', async () => {
    const { ctx } = context();
    const text = await tool('conduktor_get_kind_schema').run({ kind: 'Topic' }, ctx);
    const json = /```json\n([\s\S]*?)\n```/.exec(text)?.[1];
    const yaml = /```yaml\n([\s\S]*?)\n```/.exec(text)?.[1];
    expect(json && yaml).toBeTruthy();
    const kindSchema: unknown = JSON.parse(json!);
    assert(isRecord(kindSchema) && isRecord(kindSchema.definitions));
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
    const result: unknown = JSON.parse(await tool('conduktor_validate').run({ yaml }, ctx));
    expect(at(result, 'documents', 0)).toMatchObject({ index: 0, kind: 'Topic', name: 'orders', valid: false });
    expect(at(result, 'documents', 0, 'errors')).toContainEqual(expect.objectContaining({ path: '/spec/partitions' }));
    expect(at(result, 'documents', 1)).toMatchObject({ name: 'ok', valid: true, errors: [] });
  });

  it('names a missing required field', async () => {
    const { ctx } = context();
    const result: unknown = JSON.parse(
      await tool('conduktor_validate').run({ yaml: topic('{ partitions: 1 }', '{ name: orders }') }, ctx),
    );
    expect(at(result, 'documents', 0, 'errors')).toContainEqual({
      path: '/metadata',
      message: "must have required property 'cluster'",
    });
  });

  it('leaves ${VAR} references for the user to set, without expanding or rejecting them', async () => {
    const { ctx } = context();
    const yaml = topic('{ partitions: "${PARTITIONS}", replicationFactor: 1, configs: { a: "${A:-x}" } }');
    const result: unknown = JSON.parse(await tool('conduktor_validate').run({ yaml }, ctx));
    expect(at(result, 'documents', 0)).toMatchObject({ valid: true, errors: [], variables: ['PARTITIONS', 'A'] });
    expect(at(result, 'note')).toMatch(/set by the user when applying/);
  });

  it('says which versions exist when the apiVersion is wrong', async () => {
    const { ctx } = context();
    const result: unknown = JSON.parse(
      await tool('conduktor_validate').run({ yaml: topic('{}').replace('v2', 'v9') }, ctx),
    );
    expect(at(result, 'documents', 0)).toMatchObject({
      valid: false,
      errors: [{ path: '/apiVersion', message: 'Topic has no v9 on local; it has v2.' }],
    });
  });

  it('reads a file when given a path', async () => {
    const readFile = vi.fn(() => topic('{ partitions: 1, replicationFactor: 1 }'));
    const { ctx } = context({ readFile });
    const result: unknown = JSON.parse(await tool('conduktor_validate').run({ path: 'topics/orders.yaml' }, ctx));
    expect(readFile).toHaveBeenCalledWith('topics/orders.yaml');
    expect(at(result, 'documents', 0, 'valid')).toBe(true);
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
    const result: unknown = JSON.parse(
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
    expect(at(result, 'note')).toMatch(/nothing was changed/i);
  });

  it('reports resources that wait for earlier ones in the same YAML as pending, not failed', async () => {
    const { ctx, client } = context();
    client.upsert.mockImplementation((_target: unknown, resource: Resource) =>
      resource.kind === 'Application'
        ? Promise.reject(new ConsoleError(404, 'Group not found', "Group with id 'team-a' not found"))
        : Promise.resolve({ resource, upsertResult: 'Created' as const }),
    );
    const yaml =
      'apiVersion: v1\nkind: Application\nmetadata: { name: shop }\nspec: { title: Shop, owner: team-a }\n---\n' +
      'apiVersion: v2\nkind: Group\nmetadata: { name: team-a }\nspec: { displayName: A }\n';
    const result: unknown = JSON.parse(await tool('conduktor_dry_run').run({ yaml }, ctx));
    expect(at(result, 'documents')).toEqual([
      { index: 1, kind: 'Group', name: 'team-a', result: 'Created' },
      {
        index: 0,
        kind: 'Application',
        name: 'shop',
        pending: 'Waits for team-a, created earlier in this YAML; checked when applied.',
        error: "Group not found: Group with id 'team-a' not found",
      },
    ]);
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
    expect(parseAllDocuments(text).map((d) => at(d.toJS(), 'metadata', 'name'))).toEqual(['a', 'b']);
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

describe('secrets in tool output', () => {
  const cluster: Resource = {
    apiVersion: 'v2',
    kind: 'KafkaCluster',
    metadata: { name: 'prod' },
    spec: {
      bootstrapServers: 'kafka:9092',
      properties: {
        'security.protocol': 'SASL_SSL',
        'sasl.jaas.config': 'PlainLoginModule username="u" password="p";',
      },
      kafkaFlavor: { type: 'Gateway', url: 'http://gw', user: 'admin', password: 'conduktor' },
      schemaRegistry: {
        type: 'ConfluentLike',
        security: {
          type: 'SSLAuth',
          key: '-----BEGIN PRIVATE KEY-----\nabc',
          certificateChain: '-----BEGIN CERTIFICATE-----\nxyz',
        },
      },
      amazonSecurity: { type: 'Credentials', accessKeyId: 'AKIA', secretKey: 's3cr3t' },
    },
  };

  it('never hands credentials to the agent', async () => {
    const { ctx, client } = context();
    client.get.mockResolvedValueOnce(cluster);
    const text = await tool('conduktor_get_resources').run({ kind: 'KafkaCluster', name: 'prod' }, ctx);
    for (const secret of ['password="p"', 'conduktor', 'BEGIN PRIVATE KEY', 'AKIA', 's3cr3t'])
      expect(text).not.toContain(secret);
    expect(text).toContain('SASL_SSL');
    expect(text).toContain('BEGIN CERTIFICATE');
    expect(text).toContain('user: admin');
    expect(text).toMatch(/^# Secret values are replaced with <redacted>/);
  });

  it('rejects YAML that carries a redacted placeholder back, so a real secret is never overwritten', async () => {
    const { ctx, client } = context();
    const yaml =
      'apiVersion: v2\nkind: KafkaCluster\nmetadata: { name: prod }\nspec: { bootstrapServers: k, kafkaFlavor: { type: Gateway, url: u, user: a, password: <redacted> } }\n';
    const validation: unknown = JSON.parse(await tool('conduktor_validate').run({ yaml }, ctx));
    expect(at(validation, 'documents', 0, 'errors')).toContainEqual({
      path: '/spec/kafkaFlavor/password',
      message: 'is a redacted secret; leave it out or use a ${VAR} the user sets',
    });
    await expect(tool('conduktor_dry_run').run({ yaml }, ctx)).rejects.toThrow(/redacted secret/);
    expect(client.upsert).not.toHaveBeenCalled();
  });
});
