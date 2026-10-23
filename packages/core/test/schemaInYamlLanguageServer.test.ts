import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getLanguageService } from 'yaml-language-server';
import { snapshotSchema } from './fixtures';

const SCHEMA_URI = 'conduktor-schema://schema/test';
const service = getLanguageService({
  schemaRequestService: (uri: string) => Promise.reject(new Error(`unexpected schema request ${uri}`)),
  workspaceContext: { resolveRelativePath: (relative: string, resource: string) => new URL(relative, resource).href },
});
service.configure({
  validate: true,
  completion: true,
  hover: true,
  schemas: [{ uri: SCHEMA_URI, fileMatch: ['*.yaml'], schema: snapshotSchema }],
});

// yaml-language-server caches parsed documents by URI and version, so every document gets its own URI.
let documents = 0;
const doc = (text: string) => TextDocument.create(`file:///resources-${++documents}.yaml`, 'yaml', 1, text);

describe('generated schema in yaml-language-server', () => {
  it('validates each document of a multi-document file against its own kind', async () => {
    const text = [
      'apiVersion: v2',
      'kind: Topic',
      'metadata: { name: ok, cluster: local }',
      'spec: { partitions: 1, replicationFactor: 1 }',
      '---',
      'apiVersion: v2',
      'kind: Topic',
      'metadata: { name: bad, cluster: local }',
      'spec: { partitions: three, replicationFactor: 1 }',
    ].join('\n');
    const diagnostics = await service.doValidation(doc(text), false);
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.range.start.line >= 5)).toBe(true);
  });

  it('leaves other documents in a claimed file unvalidated', async () => {
    const text = [
      'apiVersion: v2',
      'kind: Topic',
      'metadata: { name: ok, cluster: local }',
      'spec: { partitions: 1, replicationFactor: 1 }',
      '---',
      'apiVersion: v1',
      'kind: ConfigMap',
      'metadata: { name: cfg }',
      '---',
      'apiVersion: v1',
      'kind: ServiceAccount',
      'metadata: { name: web, namespace: shop }',
    ].join('\n');
    expect(await service.doValidation(doc(text), false)).toEqual([]);
  });

  it('completes spec fields once the kind is known', async () => {
    const text = 'apiVersion: v2\nkind: Topic\nmetadata:\n  name: t\n  cluster: c\nspec:\n  ';
    const completion = await service.doComplete(doc(text), { line: 6, character: 2 }, false);
    const labels = completion.items.map((i) => i.label);
    expect(labels).toContain('partitions');
    expect(labels).not.toContain('bootstrapServers');
  });

  it('completes kind names', async () => {
    const completion = await service.doComplete(doc('apiVersion: v2\nkind: '), { line: 1, character: 6 }, false);
    expect(completion.items.map((i) => i.label)).toEqual(expect.arrayContaining(['Topic', 'KafkaCluster']));
  });
});
