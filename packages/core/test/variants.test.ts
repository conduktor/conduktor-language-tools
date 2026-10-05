import { describe, expect, it } from 'vitest';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { kindSchema } from '../src/openapi/kindSchema';
import { nextChoice } from '../src/templates';
import type { JsonSchema } from '../src/openapi/types';
import { snapshotCatalog, snapshotDoc } from './fixtures';

const schema = buildResourceSchema(snapshotDoc, snapshotCatalog);
const rootOf = (kind: string) => kindSchema(schema, snapshotCatalog.latest(kind) as never) as JsonSchema;
const choices = (kind: string, answers: Record<string, string | null> = {}) => {
  const asked: { path: string; options: string[]; optional: boolean }[] = [];
  const given: Record<string, string | null> = {};
  for (let c = nextChoice(rootOf(kind), given); c; c = nextChoice(rootOf(kind), given)) {
    const key = c.path.join('.');
    asked.push({ path: key, options: c.options, optional: c.optional });
    given[key] = key in answers ? answers[key]! : c.options[0]!;
  }
  return asked;
};

describe('nextChoice', () => {
  it('asks for the variants of a spec that is itself a union', () => {
    expect(choices('Alert')[0]).toMatchObject({ path: 'spec', optional: false });
    expect(choices('Alert')[0]!.options).toEqual(
      expect.arrayContaining(['BrokerAlert', 'TopicAlert', 'ConsumerGroupAlert', 'KafkaConnectAlert']),
    );
    expect(choices('DataQualityRule')).toEqual([{ path: 'spec', options: ['Cel', 'JsonSchema'], optional: false }]);
  });

  it('asks for optional unions under spec, offering none', () => {
    const asked = choices('KafkaCluster', { 'spec.kafkaFlavor': null, 'spec.schemaRegistry': null });
    expect(asked.map((c) => [c.path, c.optional])).toEqual([
      ['spec.schemaRegistry', true],
      ['spec.kafkaFlavor', true],
    ]);
  });

  it('asks for a union inside a chosen variant after its parent', () => {
    const asked = choices('KafkaCluster', { 'spec.kafkaFlavor': null }).map((c) => c.path);
    expect(asked[0]).toBe('spec.schemaRegistry');
    expect(asked).toContain('spec.schemaRegistry.security');
    expect(asked.indexOf('spec.schemaRegistry.security')).toBe(1);
  });

  it('asks nothing for a kind without unions', () => {
    expect(choices('Topic')).toEqual([]);
  });
});
