import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { KindCatalog } from '../src/openapi/kindCatalog';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import type { OpenApiDoc } from '../src/openapi/types';
import { snapshotCatalog, snapshotSchema } from './fixtures';

const validate = new Ajv({ strict: false, validateFormats: false, allErrors: true }).compile(snapshotSchema);
// The schema errors, so a failure shows them; none for a valid value.
const errorsOf = (value: unknown) => (validate(value) ? [] : validate.errors);

const topic = {
  apiVersion: 'v2',
  kind: 'Topic',
  metadata: { name: 'orders', cluster: 'local' },
  spec: { partitions: 3, replicationFactor: 1, configs: {} },
};

// The Console publishes this example with the role instanceViewConfig, which is not in the instance permission enum.
const KNOWN_INVALID_EXAMPLES = new Set(['ApplicationGroup v1']);

describe('buildResourceSchema', () => {
  const examples = snapshotCatalog
    .kinds()
    .filter((kv) => kv.applyExample !== undefined)
    .map((kv) => [`${kv.kind} v${kv.version}`, kv.applyExample] as const);

  it.each(examples.filter(([name]) => !KNOWN_INVALID_EXAMPLES.has(name)))(
    'accepts the published %s example',
    (_, example) => {
      expect(errorsOf(example)).toEqual([]);
    },
  );

  it.each(examples.filter(([name]) => KNOWN_INVALID_EXAMPLES.has(name)))(
    'still rejects the known-invalid %s example',
    (_, example) => {
      expect(validate(example)).toBe(false);
    },
  );

  it('accepts a minimal topic', () => {
    expect(errorsOf(topic)).toEqual([]);
  });

  it("accepts the CLI's group-qualified apiVersion, and checks the kind's body under it", () => {
    expect(errorsOf({ ...topic, apiVersion: 'kafka/v2' })).toEqual([]);
    expect(validate({ ...topic, apiVersion: 'kafka/v2', spec: { ...topic.spec, partitions: 'three' } })).toBe(false);
    expect(validate({ ...topic, apiVersion: 'iam/v2' })).toBe(false);
  });

  it.each([
    ['a wrong field type inside the kind body', { ...topic, spec: { ...topic.spec, partitions: 'three' } }],
    ['a kind body without spec', { apiVersion: 'v2', kind: 'Topic', metadata: { name: 'x', cluster: 'c' } }],
    ['a version the kind does not have', { ...topic, apiVersion: 'v9' }],
    ['a Console kind without metadata', { apiVersion: 'v1', kind: 'Application', spec: {} }],
  ])('rejects %s', (_, value) => {
    expect(validate(value)).toBe(false);
  });

  it('does not judge documents that are not Console resources', () => {
    expect(validate({ apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'cfg' } })).toBe(true);
    expect(validate({ apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'web', namespace: 'shop' } })).toBe(
      true,
    );
    expect(validate({ apiVersion: 'argoproj.io/v1alpha1', kind: 'Application', metadata: { name: 'a' } })).toBe(true);
  });

  it('is draft-07 with every reference resolvable', () => {
    expect(snapshotSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    const refs = JSON.stringify(snapshotSchema).match(/"\$ref":"#\/definitions\/[^"]+"/g) ?? [];
    const definitions = snapshotSchema.definitions as Record<string, unknown>;
    for (const ref of refs) expect(definitions).toHaveProperty([ref.slice('"$ref":"#/definitions/'.length, -1)]);
  });

  it('tells look-alike union branches apart by their discriminator mapping', () => {
    const policy = (spec: unknown) => ({
      apiVersion: 'v1',
      kind: 'TopicPolicy',
      metadata: { name: 'p' },
      spec: { policies: { 'metadata.labels.team': spec } },
    });
    expect(errorsOf(policy({ constraint: 'NoneOf', values: ['x'] }))).toEqual([]);
    expect(validate(policy({ constraint: 'Bogus', values: ['x'] }))).toBe(false);
    expect(validate(policy({ constraint: 'Range', values: ['x'] }))).toBe(false);
  });

  it('drops OpenAPI-only keywords but keeps properties with the same names', () => {
    const doc: OpenApiDoc = {
      openapi: '3.1.0',
      paths: {
        '/public/x/v1/thing': {
          get: {},
          put: {
            tags: ['cli_thing_x_v1_1'],
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } } },
          },
        },
      },
      components: {
        schemas: {
          Thing: {
            type: 'object',
            example: { a: 1 },
            discriminator: { propertyName: 'type' },
            properties: { example: { type: 'string' }, discriminator: { type: 'number' } },
          },
        },
      },
    };
    const definitions = buildResourceSchema(doc, KindCatalog.fromOpenApi(doc)).definitions as Record<
      string,
      { properties: Record<string, unknown> }
    >;
    const thing = definitions.Thing!;
    expect(thing).not.toHaveProperty('example');
    expect(thing).not.toHaveProperty('discriminator');
    expect(Object.keys(thing.properties)).toEqual(['example', 'discriminator', 'apiVersion', 'kind']);
  });
});
