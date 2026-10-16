import { InsertTextFormat, type TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { describe, expect, it } from 'vitest';
import { createSchemaService } from '../src/schemaService';
import { snapshotSpec } from './fixtures';

// yaml-language-server caches parsed documents by URI and version, so every document gets its own URI.
let documents = 0;
const doc = (...lines: string[]) =>
  TextDocument.create(`file:///work/resources-${++documents}.yaml`, 'yaml', 1, lines.join('\n'));

const topic = (spec: string) => doc('apiVersion: v2', 'kind: Topic', 'metadata: { name: t, cluster: local }', spec);
const configMap = () => doc('apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: cfg', 'data:', '  ');

function loaded() {
  const service = createSchemaService();
  service.useSpec(snapshotSpec);
  return service;
}

describe('the schema service', () => {
  it('reports what breaks the Console schema, on its line', async () => {
    const diagnostics = await loaded().validate(topic('spec: { partitions: three, replicationFactor: 1 }'));
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.range.start.line === 3 && d.source === 'Conduktor')).toBe(true);
  });

  it('leaves YAML syntax to the YAML server the editor already runs', async () => {
    const diagnostics = await loaded().validate(
      doc('apiVersion: v2', 'kind: Topic', 'metadata: { name: t, cluster: local }', 'metadata: {}', 'spec: [1'),
    );
    expect(diagnostics.filter((d) => d.source !== 'Conduktor')).toEqual([]);
  });

  it('takes a document from its kind alone, and says what is missing', async () => {
    const service = loaded();
    const diagnostics = await service.validate(doc('kind: Topic', 'spec:', '  '));
    expect(diagnostics.map((d) => d.message)).toContain('Missing property "apiVersion".');
    const completion = await service.complete(doc('kind: Topic', 'apiVersion: '), { line: 1, character: 12 });
    expect(completion?.items.map((i) => i.label)).toContain('v2');
  });

  it('offers only the versions of the kind being written', async () => {
    const completion = await loaded().complete(doc('kind: Topic', 'apiVersion: '), { line: 1, character: 12 });
    const versions = completion?.items.map((i) => i.label).filter((label) => /^v\d+$/.test(label));
    expect(versions).toEqual(['v2']);
  });

  it('offers a whole resource per kind in an empty file, replacing the word being typed', async () => {
    const completion = await loaded().complete(doc('top'), { line: 0, character: 3 });
    const topic = completion?.items.find((i) => i.label === 'Conduktor: Topic');
    expect(topic).toMatchObject({
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
    });
    expect((topic?.textEdit as TextEdit).newText).toMatch(/^apiVersion: v2\nkind: Topic\nmetadata:\n {2}name: \$\{1:/);
  });

  it('offers resources after --- in a file of Console resources, and not in a Kubernetes one', async () => {
    const service = loaded();
    const console = await service.complete(doc('kind: Topic', '---', ''), { line: 2, character: 0 });
    expect(console?.items.map((i) => i.label)).toContain('Conduktor: Group');
    expect(
      await service.complete(doc('apiVersion: v1', 'kind: ConfigMap', '---', ''), { line: 3, character: 0 }),
    ).toBeNull();
  });

  it('answers nothing for YAML that is not a Console resource', async () => {
    const service = loaded();
    expect(await service.validate(configMap())).toEqual([]);
    expect(await service.complete(configMap(), { line: 5, character: 2 })).toBeNull();
    expect(await service.hover(configMap(), { line: 1, character: 7 })).toBeNull();
  });

  it('answers nothing before a spec is loaded', async () => {
    const service = createSchemaService();
    const document = topic('spec: { partitions: three }');
    expect(await service.validate(document)).toEqual([]);
    expect(await service.complete(document, { line: 3, character: 7 })).toBeNull();
  });

  it("completes a Topic's spec fields", async () => {
    const completion = await loaded().complete(topic('spec:\n  '), { line: 4, character: 2 });
    const labels = completion?.items.map((i) => i.label);
    expect(labels).toContain('partitions');
    expect(labels).not.toContain('bootstrapServers');
  });

  it('hovers a field with its schema, without pointing at a schema URI the editor cannot open', async () => {
    const hover = await loaded().hover(topic('spec:\n  partitions: 1\n  replicationFactor: 1'), {
      line: 5,
      character: 4,
    });
    const text = JSON.stringify(hover?.contents);
    expect(text).toContain('Number of replicas');
    expect(text).not.toContain('conduktor-schema');
  });
});
