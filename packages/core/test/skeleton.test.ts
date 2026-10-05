import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { kindSchema } from '../src/openapi/kindSchema';
import { nextChoice, skeletonYaml } from '../src/templates';
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

  it('is valid for every kind and first variant, placeholders aside', () => {
    const ajv = new Ajv({ strict: false, validateFormats: false, allErrors: true });
    const placeholderOnly = new Set([
      'pattern',
      'minLength',
      'minimum',
      'exclusiveMinimum',
      'minItems',
      'format',
      'if',
    ]);
    const failures: string[] = [];
    for (const name of snapshotCatalog.kindNames()) {
      const kind = snapshotCatalog.latest(name)!;
      if (!kind.bodySchema) continue;
      const check = ajv.compile(rootOf(name));
      const parents = Object.fromEntries(kind.parentPathParams.map((p) => [p, 'local']));
      const value = parse(render(name, firstAnswers(name), parents));
      if (!check(value)) {
        const real = (check.errors ?? []).filter((e) => !placeholderOnly.has(e.keyword));
        if (real.length > 0) failures.push(`${name}: ${real.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
