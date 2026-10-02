import { describe, expect, it, vi } from 'vitest';
import { ConsoleError } from '../src/client/errors';
import { upsertDocuments } from '../src/plan/upsertDocuments';
import { parseResourceDocuments } from '../src/resources/parseDocuments';
import { snapshotCatalog } from './fixtures';

const text = `apiVersion: v2
kind: Topic
metadata: { name: orders, cluster: local }
spec: { partitions: 3 }
---
apiVersion: v2
kind: KafkaCluster
metadata: { name: local }
spec: { displayName: Local, bootstrapServers: 'localhost:9092' }
---
apiVersion: v9
kind: Topic
metadata: { name: future, cluster: local }
spec: {}
---
apiVersion: v2
kind: Topic
metadata: { name: orphan }
spec: {}
---
apiVersion: v2
kind: Subject
metadata: { name: orders-value, cluster: local }
spec: { schemaFile: orders.avsc }
`;

describe('upsertDocuments', () => {
  it('dry-runs in apply order and reports per-document outcomes', async () => {
    const upsert = vi.fn(async (target: { path: string }, _resource: unknown, _options: { dryRun: boolean }) => {
      if (target.path.endsWith('/kafka-cluster')) return { resource: {} as never, upsertResult: 'NotChanged' as const };
      return { resource: {} as never, upsertResult: 'Created' as const };
    });
    const documents = parseResourceDocuments(text, { env: {} });
    const items = await upsertDocuments({ upsert }, snapshotCatalog, documents, {
      dryRun: true,
      readInclude: () => '{}',
    });

    expect(items.map((i) => [i.document.resource?.metadata.name, i.outcome])).toEqual([
      ['local', { status: 'ok', result: 'NotChanged' }],
      ['orders', { status: 'ok', result: 'Created' }],
      ['future', { status: 'error', message: 'Topic v9 is not available on this Console' }],
      ['orphan', { status: 'error', message: 'metadata.cluster is required for Topic' }],
      ['orders-value', { status: 'ok', result: 'Created' }],
    ]);
    expect(upsert).toHaveBeenCalledTimes(3);
    expect(upsert.mock.calls.every(([, , options]) => options.dryRun)).toBe(true);
  });

  it('turns Console errors and parse errors into error outcomes', async () => {
    const upsert = vi.fn(async () => {
      throw new ConsoleError(403, 'No Ownership', 'You do not own orders');
    });
    const documents = parseResourceDocuments(
      'apiVersion: v2\nkind: Topic\nmetadata: { name: orders, cluster: ${C} }\nspec: {}\n---\n' +
        'apiVersion: v2\nkind: Topic\nmetadata: { name: t, cluster: local }\nspec: {}\n',
      { env: {} },
    );
    const items = await upsertDocuments({ upsert }, snapshotCatalog, documents, { dryRun: true });
    expect(items.map((i) => i.outcome)).toEqual([
      { status: 'error', message: 'Missing environment variables: C' },
      { status: 'error', message: 'No Ownership: You do not own orders' },
    ]);
  });

  it('reports an include that cannot be read without a workspace folder', async () => {
    const documents = parseResourceDocuments(text, { env: {} }).filter((d) => d.kind === 'Subject');
    const items = await upsertDocuments({ upsert: vi.fn() }, snapshotCatalog, documents, { dryRun: true });
    expect(items[0]?.outcome).toMatchObject({ status: 'error', message: expect.stringMatching(/workspace folder/) });
  });

  it('applies for real when dryRun is false', async () => {
    const upsert = vi.fn(async (_target: unknown, _resource: unknown, _options: { dryRun: boolean }) => ({
      resource: {} as never,
      upsertResult: 'Updated' as const,
    }));
    const documents = parseResourceDocuments(
      'apiVersion: v1\nkind: Application\nmetadata: { name: shop }\nspec: {}\n',
      {
        env: {},
      },
    );
    const items = await upsertDocuments({ upsert }, snapshotCatalog, documents, { dryRun: false });
    expect(items[0]?.outcome).toEqual({ status: 'ok', result: 'Updated' });
    expect(upsert.mock.calls[0]?.[2]).toEqual({ dryRun: false });
  });
});
