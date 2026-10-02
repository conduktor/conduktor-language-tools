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

  it('reports a document that is still invalid YAML after expanding variables', () => {
    const docs = parseResourceDocuments('apiVersion: v2\nkind: Topic\nmetadata: { name: ${N}, labels: [unclosed }\n', {
      env: { N: 't' },
    });
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ kind: 'Topic', apiVersion: 'v2' });
    expect(docs[0]!.error).toBeTruthy();
  });

  it('leaves other invalid YAML to the YAML extension', () => {
    expect(parseResourceDocuments('apiVersion: v2\nkind: Topic\nmetadata: [unclosed\n', { env: {} })).toEqual([]);
  });

  it('expands variables before parsing, as ctl does, so they work inside flow mappings', () => {
    const docs = parseResourceDocuments('apiVersion: v2\nkind: Topic\nmetadata: { name: t, cluster: ${C} }\n', {
      env: { C: 'local' },
    });
    expect(docs[0]?.resource?.metadata).toEqual({ name: 't', cluster: 'local' });
    expect(
      parseResourceDocuments('apiVersion: v2\nkind: Topic\nmetadata: { name: t, cluster: ${C} }\n', { env: {} })[0],
    ).toMatchObject({ error: 'Missing environment variables: C' });
  });

  it('requires metadata.name', () => {
    const docs = parseResourceDocuments('apiVersion: v2\nkind: Topic\nmetadata: {}\n', { env: {} });
    expect(docs[0]).toMatchObject({ error: 'metadata.name is required' });
  });

  it('splits Windows line endings the same way', () => {
    const docs = parseResourceDocuments(
      'apiVersion: v1\r\nkind: Application\r\nmetadata:\r\n  name: a\r\n---\r\n\r\napiVersion: v1\r\nkind: Application\r\nmetadata:\r\n  name: b\r\n',
      { env: {} },
    );
    expect(docs.map((d) => d.resource?.metadata.name)).toEqual(['a', 'b']);
  });

  it('returns nothing for an empty or comment-only file', () => {
    expect(parseResourceDocuments('', { env: {} })).toEqual([]);
    expect(parseResourceDocuments('# nothing\n---\n', { env: {} })).toEqual([]);
  });
});

describe('catalogDocuments', () => {
  it('ignores Kubernetes, Argo CD and Helm documents whose kinds share a Console kind name', () => {
    const gitops = [
      'apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: web\n  namespace: shop\n',
      'apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: shop\n  namespace: argocd\nspec: {}\n',
      'apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: {{ include "web.fullname" . }}\n  namespace: {{ .Release.Namespace }}\n',
      'apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: payments\n  cluster: local\nspec: {}\n',
    ].join('---\n');
    const docs = catalogDocuments(gitops, snapshotCatalog, { env: {} });
    expect(docs.map((d) => [d.index, d.kind, d.resource?.metadata.name])).toEqual([[3, 'ServiceAccount', 'payments']]);
  });

  it('drops kinds the Console does not know, including Kubernetes look-alikes', () => {
    const docs = catalogDocuments(file, snapshotCatalog, { env: { CLUSTER: 'local' } });
    expect(docs.map((d) => [d.index, d.kind])).toEqual([
      [0, 'Topic'],
      [3, 'Application'],
    ]);
  });
});
