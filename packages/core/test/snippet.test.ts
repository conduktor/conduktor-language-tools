import { describe, expect, it } from 'vitest';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { kindSchema } from '../src/openapi/kindSchema';
import type { JsonSchema } from '../src/openapi/types';
import { skeletonYaml, snippetOf, snippetVariants } from '../src/templates';
import { snapshotCatalog, snapshotDoc } from './fixtures';

const schema = buildResourceSchema(snapshotDoc, snapshotCatalog);
const rootOf = (kind: string) => kindSchema(schema, snapshotCatalog.latest(kind) as never) as JsonSchema;

describe('snippetOf', () => {
  it('puts tab stops on the name, a choice of clusters and the empty placeholders', () => {
    const text = 'apiVersion: v2\nkind: Topic\nmetadata:\n  name: my-topic\n  cluster: local\nspec:\n  owner: ""\n';
    expect(snippetOf(text, { 'metadata.cluster': ['local', 'prod'] })).toBe(
      'apiVersion: v2\nkind: Topic\nmetadata:\n  name: ${1:my-topic}\n  cluster: ${2|local,prod|}\nspec:\n  owner: "${3}"\n',
    );
  });

  it('escapes what a snippet would read as syntax', () => {
    const text = 'kind: X\nmetadata:\n  name: a\nspec:\n  expression: size(value.$x) > 0 }\n  # {not} a $var\n';
    expect(snippetOf(text, {})).toBe(
      'kind: X\nmetadata:\n  name: ${1:a}\nspec:\n  expression: size(value.\\$x) > 0 \\}\n  # {not\\} a \\$var\n',
    );
    expect(snippetOf('metadata:\n  name: a\n  cluster: b\n', { 'metadata.cluster': ['x,y', 'p|q'] })).toBe(
      'metadata:\n  name: ${1:a}\n  cluster: ${2|x\\,y,p\\|q|}\n',
    );
  });
});

describe('snippetVariants', () => {
  it('gives a default and one per option of each union under spec', () => {
    const labels = snippetVariants(rootOf('KafkaCluster')).map((v) => v.label);
    expect(labels[0]).toBeUndefined();
    expect(labels).toEqual(expect.arrayContaining(['kafkaFlavor Gateway', 'schemaRegistry ConfluentLike']));
    expect(snippetVariants(rootOf('Alert')).map((v) => v.label)).toEqual(
      expect.arrayContaining(['BrokerAlert', 'TopicAlert']),
    );
    expect(snippetVariants(rootOf('Topic'))).toEqual([{ answers: {} }]);
  });

  it('builds a snippet with a first tab stop for every kind and variant', () => {
    for (const name of snapshotCatalog.kindNames()) {
      const kind = snapshotCatalog.latest(name)!;
      if (!kind.bodySchema) continue;
      for (const { answers } of snippetVariants(rootOf(name))) {
        const snippet = snippetOf(skeletonYaml(rootOf(name), kind, {}, 'n', answers), {});
        expect(snippet).toMatch(/\$\{1:/);
      }
    }
  });
});
