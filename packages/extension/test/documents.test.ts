import { readFileSync } from 'node:fs';
import { buildSpec } from '@conduktor/vscode-core';
import { describe, expect, it } from 'vitest';
import { documentAt, parsedDocuments } from '../src/intel/documents';

const { catalog } = buildSpec(
  readFileSync(new URL('../../core/snapshot/public-api-doc.yaml', import.meta.url), 'utf8'),
  'snapshot',
);
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
    const [app, ...rest] = parsedDocuments(text, catalog);
    expect(rest).toEqual([]);
    expect(app!.start).toBe(text.indexOf('apiVersion: v1\nkind: Application'));
    expect(app!.resource?.metadata.name).toBe('shop');
    expect(documentAt(text, text.indexOf('team-a'), catalog)?.start).toBe(app!.start);
    expect(documentAt(text, text.indexOf('k8s'), catalog)).toBeUndefined();
  });

  it('still gives a document whose YAML is half written', () => {
    expect(parsedDocuments('apiVersion: v1\nkind: Application\nspec: { owner: [\n', catalog)).toHaveLength(1);
  });
});
