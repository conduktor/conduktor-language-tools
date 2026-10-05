import { describe, expect, it } from 'vitest';
import { fieldAt } from '../src/resources/yamlPaths';

const text =
  'kind: KafkaCluster\nspec:\n  kafkaFlavor:\n    type: Confluent\n  permissions:\n    - resourceType: TOPIC\n';
const at = (needle: string, inside = 1) => fieldAt(text, text.indexOf(needle) + inside);

describe('fieldAt', () => {
  it('names the field under a key or a value', () => {
    expect(at('kafkaFlavor')?.path).toEqual(['spec', 'kafkaFlavor']);
    expect(at('type:')?.path).toEqual(['spec', 'kafkaFlavor', 'type']);
    expect(at('Confluent')?.path).toEqual(['spec', 'kafkaFlavor', 'type']);
    expect(at('resourceType')?.path).toEqual(['spec', 'permissions', 0, 'resourceType']);
    expect(at('kind')?.path).toEqual(['kind']);
  });

  it('gives the key its own range', () => {
    const found = at('kafkaFlavor')!;
    expect(text.slice(found.start, found.end)).toBe('kafkaFlavor');
  });
});
