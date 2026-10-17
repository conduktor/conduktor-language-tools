import { describe, expect, it } from 'vitest';
import { catalogDocuments, claimsForEditing, parseResourceDocuments } from '../src/resources/parseDocuments';
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

  it.each([
    ['as written', 'metadata: [unclosed\n', {}],
    ['once its variables are expanded', 'metadata: { name: ${N}, labels: [unclosed }\n', { N: 't' }],
  ])('reports a resource-like document that is invalid YAML %s', (_, metadata, env) => {
    const docs = parseResourceDocuments(`apiVersion: v2\nkind: Topic\n${metadata}`, { env });
    expect(docs).toMatchObject([{ kind: 'Topic', apiVersion: 'v2' }]);
    expect(docs[0]!.error).toBeTruthy();
  });

  it('leaves unparseable templates (Helm, Go templates) alone', () => {
    expect(parseResourceDocuments('apiVersion: v1\nkind: Topic\nmetadata:\n  name: {{ .Name }\n', { env: {} })).toEqual(
      [],
    );
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
  it('keeps Console-looking documents that are broken, so the dry run can say what is wrong', () => {
    const broken = [
      'apiVersion: v1\nkind: Topic\nmetadata: { name: wrong-version, cluster: local }\nspec: {}\n',
      'apiVersion: v2\nkind: Topic\nmetadata: [unclosed\n',
      'apiVersion: v2\nkind: Topic\nspec: {}\n',
    ].join('---\n');
    const docs = catalogDocuments(broken, snapshotCatalog, { env: {} });
    expect(docs.map((d) => d.index)).toEqual([0, 1, 2]);
    expect(docs[1]!.error).toBeTruthy();
    expect(docs[2]!.error).toBe('metadata.name is required');
  });

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

  it("keeps the CLI's group-qualified apiVersion, in the kind's own group", () => {
    const text = [
      'apiVersion: kafka/v2\nkind: Topic\nmetadata: { name: a, cluster: local }\nspec: {}\n',
      'apiVersion: self-serve/v1\nkind: Application\nmetadata: { name: shop }\nspec: {}\n',
      'apiVersion: iam/v2\nkind: Topic\nmetadata: { name: wrong-group, cluster: local }\nspec: {}\n',
    ].join('---\n');
    expect(catalogDocuments(text, snapshotCatalog, { env: {} }).map((d) => [d.index, d.kind])).toEqual([
      [0, 'Topic'],
      [1, 'Application'],
    ]);
  });

  it('drops kinds the Console does not know, including Kubernetes look-alikes', () => {
    const docs = catalogDocuments(file, snapshotCatalog, { env: { CLUSTER: 'local' } });
    expect(docs.map((d) => [d.index, d.kind])).toEqual([
      [0, 'Topic'],
      [3, 'Application'],
    ]);
  });
});

describe('claimsForEditing', () => {
  it.each([
    ['as soon as it names a Console kind, before its apiVersion is written', 'kind: Topic\nspec:\n  '],
    ['with a Console apiVersion', 'apiVersion: v2\nkind: Topic'],
    ["with the CLI's group-qualified apiVersion", 'apiVersion: kafka/v2\nkind: Topic'],
    ['in a file where any document is a Console resource', 'apiVersion: v1\nkind: ConfigMap\n---\nkind: Topic'],
    ['that is half written, by its kind', 'kind: Topic\nspec:\n  partitions: [1'],
  ])('takes a document %s', (_, text) => expect(claimsForEditing(text, snapshotCatalog)).toBe(true));

  it.each([
    ['Kubernetes', 'apiVersion: v1\nkind: ConfigMap'],
    ['a namespaced kind the Console also has', 'apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  namespace: shop'],
    ['Argo CD', 'apiVersion: argoproj.io/v1alpha1\nkind: Application'],
    ['Strimzi', 'apiVersion: kafka.strimzi.io/v1beta2\nkind: KafkaTopic'],
    ['an empty file', ''],
    ['an unknown kind', 'kind: Topi'],
    ['YAML without a kind', 'name: ci\non: push'],
  ])('leaves %s alone', (_, text) => expect(claimsForEditing(text, snapshotCatalog)).toBe(false));
});
