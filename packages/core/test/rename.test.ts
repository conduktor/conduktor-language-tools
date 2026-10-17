import { describe, expect, it } from 'vitest';
import type { TextEdit } from '../src/fixes';
import { renameEdits } from '../src/references/rename';
import { parsedDocuments } from '../src/resources/parsedDocuments';
import { snapshotCatalog } from './fixtures';

const files = [
  'apiVersion: v2\nkind: Topic\nmetadata:\n  name: orders.v2\n  cluster: local\n',
  'apiVersion: v2\nkind: Topic\nmetadata:\n  name: orders.v2\n  cluster: prod\n',
  "apiVersion: v1\nkind: IndexedTopic\nmetadata: { name: 'orders.v2', cluster: local }\nspec: {}\n",
  'apiVersion: v2\nkind: Group\nmetadata:\n  name: readers\nspec:\n  permissions:\n    - { resourceType: TOPIC, cluster: "*", name: orders.v2, patternType: LITERAL, permissions: [topicConsume] }\n    - { resourceType: TOPIC, cluster: local, name: orders.v2, patternType: LITERAL, permissions: [topicConsume] }\n    - { resourceType: TOPIC, cluster: local, name: "orders.", patternType: PREFIXED, permissions: [topicConsume] }\n    - { resourceType: TOPIC, cluster: local, name: "*", patternType: LITERAL, permissions: [topicConsume] }\n',
];
const documents = files.flatMap((text) => parsedDocuments(text, snapshotCatalog));
const apply = (text: string, edits: TextEdit[]) =>
  [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce((out, e) => out.slice(0, e.start) + e.newText + out.slice(e.end), text);

function renamed(name: string, newName: string, parents = ['local']) {
  const { edits, patterns } = renameEdits({ kind: 'Topic', parents, name }, newName, documents, snapshotCatalog);
  const texts = documents.map((d, i) =>
    apply(
      d.text,
      edits.filter((e) => e.index === i).map((e) => e.edit),
    ),
  );
  return { texts, patterns };
}

describe('renameEdits', () => {
  it('rename a resource and what names it, in its scope, keeping quotes', () => {
    const { texts } = renamed('orders.v2', 'orders.v3');
    expect(texts[0]).toContain('  name: orders.v3\n');
    expect(texts[1]).toBe(files[1]);
    expect(texts[2]).toContain("metadata: { name: 'orders.v3', cluster: local }");
    expect(texts[3]).toContain('cluster: local, name: orders.v3,');
  });

  it('leave patterns, wildcards and every-cluster references as written, and count them', () => {
    const { texts, patterns } = renamed('orders.v2', 'billing.v2');
    expect(texts[3]).toContain('cluster: "*", name: orders.v2,');
    expect(texts[3]).toContain('name: "orders.", patternType: PREFIXED');
    expect(texts[3]).toContain('name: "*", patternType: LITERAL');
    expect(patterns).toBe(3);
  });

  it('quote a new name YAML would read as something else', () => {
    expect(renamed('orders.v2', 'true').texts[0]).toContain('  name: "true"\n');
    expect(renamed('orders.v2', 'a, b').texts[3]).toContain('name: "a, b",');
  });
});
