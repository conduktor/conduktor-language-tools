import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { kindSchema } from '../src/openapi/kindSchema';
import { fixedNames, nextChoice, skeletonYaml } from '../src/templates';
import type { JsonSchema } from '../src/openapi/types';
import { snapshotCatalog, snapshotDoc } from './fixtures';

const schema = buildResourceSchema(snapshotDoc, snapshotCatalog);
const rootOf = (kind: string) => kindSchema(schema, snapshotCatalog.latest(kind) as never) as JsonSchema;
const firstAnswers = (kind: string) => {
  const answers: Record<string, string | null> = {};
  for (let c = nextChoice(rootOf(kind), answers); c; c = nextChoice(rootOf(kind), answers))
    answers[c.path.join('.')] = c.options[0]!;
  return answers;
};
const render = (kind: string, answers = firstAnswers(kind), parents: Record<string, string> = {}) =>
  skeletonYaml(rootOf(kind), snapshotCatalog.latest(kind)!, parents, `my-${kind.toLowerCase()}`, answers);

// Every answer combination: each union's options in turn (or none, when optional).
function allAnswers(root: JsonSchema): Record<string, string | null>[] {
  const expand = (answers: Record<string, string | null>): Record<string, string | null>[] => {
    const choice = nextChoice(root, answers);
    if (!choice) return [answers];
    const values: (string | null)[] = [...choice.options, ...(choice.optional ? [null] : [])];
    return values.flatMap((value) => expand({ ...answers, [choice.path.join('.')]: value }));
  };
  return expand({});
}

// A discriminated oneOf read as "the option whose tag matches", so a placeholder in the chosen variant is not also
// reported against every other variant.
function discriminated(root: JsonSchema): JsonSchema {
  const copy = structuredClone(root) as JsonSchema;
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.oneOf)) {
      const tagged = (record.oneOf as JsonSchema[]).map((option) => {
        const parts = (Array.isArray(option.allOf) ? option.allOf : []) as JsonSchema[];
        const tag = parts.find((p) => p.properties && Object.keys(p.properties).length === 1 && !p.$ref);
        return tag ? { if: { properties: tag.properties, required: tag.required }, then: option } : undefined;
      });
      if (tagged.every(Boolean)) {
        delete record.oneOf;
        record.allOf = [...(Array.isArray(record.allOf) ? record.allOf : []), ...tagged];
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(copy);
  return copy;
}

describe('skeletonYaml', () => {
  it('fills required fields, names the chosen variant and comments the optional ones', () => {
    const text = render('KafkaCluster', { 'spec.schemaRegistry': null, 'spec.kafkaFlavor': 'Gateway' });
    const value = parse(text);
    expect(value).toMatchObject({ apiVersion: 'v2', kind: 'KafkaCluster', metadata: { name: 'my-kafkacluster' } });
    expect(Object.keys(value.spec)).toEqual(expect.arrayContaining(['displayName', 'bootstrapServers', 'kafkaFlavor']));
    expect(value.spec.kafkaFlavor.type).toBe('Gateway');
    expect(value.spec).not.toHaveProperty('schemaRegistry');
    expect(text).toMatch(/# color: string/);
  });

  it('fills parents and the name', () => {
    const value = parse(render('Topic', {}, { cluster: 'local' }));
    expect(value.metadata).toEqual({ name: 'my-topic', cluster: 'local' });
    expect(value.spec.partitions).toEqual(expect.any(Number));
  });

  it('gives a kind with an empty spec a minimal document', () => {
    expect(parse(render('ChargebackLabel'))).toMatchObject({ kind: 'ChargebackLabel', spec: {} });
  });

  it('is valid for every kind and every combination of variants, placeholders aside', () => {
    const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
    const placeholderOnly = new Set(['pattern', 'minLength', 'minItems', 'format', 'if']);
    const failures: string[] = [];
    let rendered = 0;
    for (const name of snapshotCatalog.kindNames()) {
      const kind = snapshotCatalog.latest(name)!;
      if (!kind.bodySchema) continue;
      const root = rootOf(name);
      const check = ajv.compile(discriminated(root));
      const parents = Object.fromEntries(kind.parentPathParams.map((p) => [p, 'local']));
      for (const answers of allAnswers(root)) {
        rendered++;
        const value = parse(skeletonYaml(root, kind, parents, 'my-name', answers));
        if (check(value)) continue;
        const real = (check.errors ?? []).filter((e) => !placeholderOnly.has(e.keyword));
        if (real.length > 0)
          failures.push(
            `${name} ${JSON.stringify(answers)}: ${real.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`,
          );
      }
    }
    expect(rendered).toBeGreaterThan(100);
    expect(failures).toEqual([]);
  });

  it('keeps every object editable: optional fields of an empty one on its line, others uncomment cleanly', () => {
    const user = render('User');
    expect(user).not.toMatch(/^\s*\{\}\s*$/m);
    expect(user).toMatch(/^spec: \{\} # optional: \w+ \(/m);
    const cluster = render('KafkaCluster', { 'spec.schemaRegistry': null, 'spec.kafkaFlavor': null });
    const line = cluster.split('\n').find((l) => /^\s+# color: /.test(l))!;
    const uncommented = parse(cluster.replace(line, line.replace('# color: string', 'color: red')));
    expect(uncommented.spec.color).toBe('red');
  });

  it('names a field that is one of several shapes by their names', () => {
    expect(render('Integration')).toMatch(/config \(one of \w+, \w+\)/);
    expect(render('Group')).toMatch(/permissions: list of one of CLUSTER, /);
  });

  it('starts numbers above an exclusive minimum', () => {
    const node = { type: 'object', required: ['n'], properties: { n: { type: 'integer', exclusiveMinimum: 0 } } };
    const root = {
      allOf: [{ $ref: '#/definitions/R' }],
      definitions: { R: { type: 'object', properties: { spec: node } } },
    };
    expect(parse(skeletonYaml(root, snapshotCatalog.latest('Topic')!, {}, 'n', {})).spec.n).toBe(1);
  });

  it('stops on a schema that refers to itself', () => {
    const tree = { type: 'object', required: ['child'], properties: { child: { $ref: '#/definitions/Tree' } } };
    const root = {
      allOf: [{ $ref: '#/definitions/R' }],
      definitions: {
        R: { type: 'object', required: ['spec'], properties: { spec: { $ref: '#/definitions/Tree' } } },
        Tree: tree,
      },
    };
    expect(() => skeletonYaml(root, snapshotCatalog.latest('Topic')!, {}, 'n', {})).not.toThrow();
    expect(nextChoice(root, {})).toBeUndefined();
  });

  it('uses a given name that is one of the allowed names', () => {
    const kind = snapshotCatalog.latest('Integration')!;
    expect(parse(skeletonYaml(rootOf('Integration'), kind, {}, 'Email', {})).metadata.name).toBe('Email');
  });

  it('knows the names a kind is limited to', () => {
    expect(fixedNames(rootOf('Integration'))).toEqual(expect.arrayContaining(['Slack']));
    expect(fixedNames(rootOf('Topic'))).toBeUndefined();
  });
});
