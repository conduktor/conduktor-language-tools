import { describe, expect, it } from 'vitest';
import { skeletonYaml } from '../src/templates/skeleton';
import { snippetOf, snippetVariants } from '../src/templates/snippet';
import { parse } from 'yaml';
import { at, rootOf, snapshotCatalog } from './fixtures';

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

// What VS Code inserts when every tab stop keeps its default: the first choice, the placeholder, unescaped.
function accepted(snippet: string): string {
  const unescape = (text: string) => text.replace(/\\([$}\\,|])/g, '$1');
  return snippet
    .replace(/\$\{\d+\|((?:\\.|[^,|\\])*)(?:,(?:\\.|[^|\\])*)?\|\}/g, (_m, first: string) => unescape(first))
    .replace(/\$\{\d+:((?:\\.|[^}\\])*)\}/g, (_m, value: string) => unescape(value))
    .replace(/\$\{\d+\}/g, '')
    .replace(/\\([$}\\])/g, '$1');
}

describe('snippets once accepted', () => {
  it('keep names YAML would read as something else strings', () => {
    for (const cluster of ['true', '1', 'null', '1e3']) {
      const text = skeletonYaml(rootOf('Topic'), snapshotCatalog.latest('Topic')!, { cluster }, '2024', {});
      const value: unknown = parse(accepted(snippetOf(text, { 'metadata.cluster': [cluster, 'other'] })));
      expect(at(value, 'metadata')).toEqual({ name: '2024', cluster });
    }
  });

  it('drop an empty choice rather than break the snippet', () => {
    expect(snippetOf('metadata:\n  name: a\n  cluster: b\n', { 'metadata.cluster': ['', 'b'] })).toContain('${2|b|}');
  });
});

describe('snippetVariants', () => {
  it('never offers the same document twice', () => {
    for (const name of ['ServiceAccount', 'KafkaCluster', 'Alert', 'DataQualityRule']) {
      const answers = snippetVariants(rootOf(name)).map((v) => JSON.stringify(v.answers));
      expect({ name, answers }).toEqual({ name, answers: [...new Set(answers)] });
    }
  });

  it("labels a variant by what it inserts: a union spec's own types only", () => {
    expect(snippetVariants(rootOf('Alert')).every((v) => !v.label?.includes(' '))).toBe(true);
  });

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
