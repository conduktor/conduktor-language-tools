import { describe, expect, it } from 'vitest';
import { comparableYaml } from '../src/resources/yamlText';
import { prettySchema } from '../src/resources/prettySchema';
import type { Resource } from '../src/resources/types';

const subject = (schema: string, format?: string): Resource => ({
  apiVersion: 'v2',
  kind: 'Subject',
  metadata: { name: 'orders-value', cluster: 'local' },
  spec: { schema, ...(format && { format }) },
});
const schemaOf = (resource: Resource) => (resource.spec as { schema: string }).schema;
const compact = '{"type":"record","name":"Order","fields":[{"name":"id","type":"string"}]}';

describe('prettySchema', () => {
  it('lays out a JSON or Avro schema over lines, keeping its key order', () => {
    const pretty = schemaOf(prettySchema(subject(compact, 'AVRO')));
    expect(pretty).toBe(`${JSON.stringify(JSON.parse(compact), null, 2)}\n`);
    expect(schemaOf(prettySchema(subject(compact)))).toBe(pretty);
    expect(schemaOf(prettySchema(subject('{"type":"object"}', 'JSON')))).toBe('{\n  "type": "object"\n}\n');
  });

  it('leaves protobuf, unparseable schemas and other kinds alone', () => {
    const proto = subject('syntax = "proto3";\nmessage A {}\n', 'PROTOBUF');
    expect(prettySchema(proto)).toBe(proto);
    const broken = subject('{"type":', 'JSON');
    expect(prettySchema(broken)).toBe(broken);
    const topic: Resource = { apiVersion: 'v2', kind: 'Topic', metadata: { name: 't' }, spec: { schema: compact } };
    expect(prettySchema(topic)).toBe(topic);
  });

  it('never counts formatting as a change', () => {
    const pretty = prettySchema(subject(compact, 'AVRO'));
    expect(comparableYaml(subject(compact, 'AVRO'))).toBe(comparableYaml(pretty));
    expect(comparableYaml(pretty)).toContain('schema: |');
  });
});
