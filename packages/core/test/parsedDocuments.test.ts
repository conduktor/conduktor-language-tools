import { describe, expect, it } from 'vitest';
import { documentAt, parsedDocuments } from '../src/resources/parsedDocuments';
import { snapshotCatalog } from './fixtures';

const text = `apiVersion: v1
kind: ConfigMap
metadata: { name: k8s, namespace: x }
---
apiVersion: v1
kind: Application
metadata: { name: shop }
spec: { owner: team-a }
`;

describe('parsedDocuments', () => {
  it('keeps only Console documents, with their offsets and parsed resources', () => {
    const [app, ...rest] = parsedDocuments(text, snapshotCatalog);
    expect(rest).toEqual([]);
    expect(app!.start).toBe(text.indexOf('apiVersion: v1\nkind: Application'));
    expect(app!.resource?.metadata.name).toBe('shop');
    expect(documentAt(text, text.indexOf('team-a'), snapshotCatalog)?.start).toBe(app!.start);
    expect(documentAt(text, text.indexOf('k8s'), snapshotCatalog)).toBeUndefined();
  });

  it('still reads a document with a broken line elsewhere, so completion keeps working while typing', () => {
    const [app] = parsedDocuments(
      'apiVersion: v1\nkind: Application\nmetadata: { name: shop }\nspec:\n  owner: \n  title: "unterminated\n',
      snapshotCatalog,
    );
    expect(app?.resource?.metadata.name).toBe('shop');
    expect(app?.resource?.spec).toHaveProperty('owner');
  });
});
