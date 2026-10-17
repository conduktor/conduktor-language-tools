import { describe, expect, it } from 'vitest';
import { nextChoice } from '../src/templates/variants';
import { rootOf } from './fixtures';

const choices = (kind: string, answers: Record<string, string | null> = {}) => {
  const asked: { path: string; options: string[]; optional: boolean }[] = [];
  const given: Record<string, string | null> = {};
  for (let c = nextChoice(rootOf(kind), given); c; c = nextChoice(rootOf(kind), given)) {
    const key = c.path.join('.');
    asked.push({ path: key, options: c.options, optional: c.optional });
    given[key] = key in answers ? answers[key]! : c.options[0];
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
    expect(asked.slice(0, 2)).toEqual(['spec.schemaRegistry', 'spec.schemaRegistry.security']);
  });

  it('asks nothing for a kind without unions', () => {
    expect(choices('Topic')).toEqual([]);
  });
});
