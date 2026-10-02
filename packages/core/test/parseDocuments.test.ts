import { describe, expect, it } from 'vitest';
import { catalogDocuments, parseResourceDocuments } from '../src/resources/parseDocuments';
import { snapshotCatalog } from './fixtures';

const file = `# Orders topics
apiVersion: v2
kind: Topic
metadata:
  name: orders
  cluster: \${CLUSTER}
spec:
  partitions: 3
---
# only a comment
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: cfg
---
apiVersion: v1
kind: Application
metadata:
  name: shop
spec:
  title: Shop
---
`;

describe('parseResourceDocuments', () => {
  it('keeps resource-like documents with offsets into the original text', () => {
    const docs = parseResourceDocuments(file, { env: { CLUSTER: 'local' } });
    expect(docs.map((d) => [d.index, d.kind])).toEqual([
      [0, 'Topic'],
      [1, 'Deployment'],
      [2, 'ConfigMap'],
      [3, 'Application'],
    ]);
    expect(file.slice(docs[0]!.start, docs[0]!.end)).toMatch(/^apiVersion: v2\nkind: Topic/);
    expect(docs[0]!.resource?.metadata).toEqual({ name: 'orders', cluster: 'local' });
  });

  it('reports missing environment variables on that document only', () => {
    const docs = parseResourceDocuments(file, { env: {} });
    expect(docs[0]).toMatchObject({ kind: 'Topic', error: 'Missing environment variables: CLUSTER' });
    expect(docs[0]!.resource).toBeUndefined();
    expect(docs[3]!.resource?.metadata.name).toBe('shop');
  });

  it('reports a YAML syntax error on a resource-like document', () => {
    const docs = parseResourceDocuments('apiVersion: v2\nkind: Topic\nmetadata: [unclosed\n', { env: {} });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ kind: 'Topic' });
    expect(docs[0]!.error).toBeTruthy();
  });

  it('requires metadata.name', () => {
    const docs = parseResourceDocuments('apiVersion: v2\nkind: Topic\nmetadata: {}\n', { env: {} });
    expect(docs[0]).toMatchObject({ error: 'metadata.name is required' });
  });

  it('returns nothing for an empty or comment-only file', () => {
    expect(parseResourceDocuments('', { env: {} })).toEqual([]);
    expect(parseResourceDocuments('# nothing\n---\n', { env: {} })).toEqual([]);
  });
});

describe('catalogDocuments', () => {
  it('drops kinds the Console does not know, including Kubernetes look-alikes', () => {
    const docs = catalogDocuments(file, snapshotCatalog, { env: { CLUSTER: 'local' } });
    expect(docs.map((d) => [d.index, d.kind])).toEqual([
      [0, 'Topic'],
      [3, 'Application'],
    ]);
  });
});
