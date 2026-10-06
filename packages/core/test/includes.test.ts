import { describe, expect, it } from 'vitest';
import { expandIncludes, IncludeError } from '../src/resources/includes';
import type { Resource } from '../src/resources/types';

const subject: Resource = {
  apiVersion: 'v2',
  kind: 'Subject',
  metadata: { name: 'orders-value', cluster: 'local' },
  spec: { format: 'AVRO', schemaFile: 'schemas/orders.avsc' },
};

const topic: Resource = {
  apiVersion: 'v2',
  kind: 'Topic',
  metadata: {
    name: 'orders',
    cluster: 'local',
    labels: { team: 'a', 'conduktor.io/descriptionFile': 'docs/orders.md' },
  },
  spec: { partitions: 1 },
};

describe('expandIncludes', () => {
  it('reads a Subject schemaFile into spec.schema', () => {
    expect(expandIncludes(subject, (p) => `contents of ${p}`).spec).toEqual({
      format: 'AVRO',
      schema: 'contents of schemas/orders.avsc',
    });
  });

  it('reads a Topic descriptionFile label into metadata.description, where the Console keeps it', () => {
    const { metadata } = expandIncludes(topic, (p) => `contents of ${p}`);
    expect(metadata.labels).toEqual({ team: 'a' });
    expect(metadata.description).toBe('contents of docs/orders.md');
  });

  it('leaves no empty labels behind when the descriptionFile was the only one', () => {
    const only: Resource = {
      ...topic,
      metadata: { name: 'x', cluster: 'c', labels: { 'conduktor.io/descriptionFile': 'd.md' } },
    };
    expect(expandIncludes(only, () => 'text').metadata).toEqual({ name: 'x', cluster: 'c', description: 'text' });
  });

  it('leaves resources without includes untouched', () => {
    const plain: Resource = { ...topic, metadata: { name: 'x', cluster: 'c' } };
    expect(expandIncludes(plain)).toBe(plain);
  });

  it('explains that includes need a saved file', () => {
    expect(() => expandIncludes(subject)).toThrow(IncludeError);
    expect(() => expandIncludes(subject)).toThrow(/save the YAML as a file/);
  });

  it('names the file that could not be read', () => {
    expect(() =>
      expandIncludes(subject, () => {
        throw new Error('ENOENT');
      }),
    ).toThrow('Failed to read schemas/orders.avsc: ENOENT');
  });
});
