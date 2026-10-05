import { describe, expect, it } from 'vitest';
import { setFields } from '../src/resources/setFields';

const topic = `kind: Topic
metadata: { name: t, cluster: c }
spec:
  partitions: 3 # three for now
  configs:
    retention.ms: "86400000" # a day
    cleanup.policy: delete
`;

describe('setFields', () => {
  it('replaces values in place and adds missing keys, comments kept', () => {
    expect(setFields(topic, ['spec', 'configs'], { 'retention.ms': '604800000', 'compression.type': 'lz4' })).toBe(
      topic
        .replace('"86400000"', '"604800000"')
        .replace('    cleanup.policy: delete\n', '    cleanup.policy: delete\n    compression.type: lz4\n'),
    );
  });

  it('creates a missing map under its parent', () => {
    const bare = 'kind: Topic\nspec:\n  partitions: 3\n';
    expect(setFields(bare, ['spec'], { replicationFactor: 3, configs: { 'cleanup.policy': 'compact' } })).toBe(
      'kind: Topic\nspec:\n  partitions: 3\n  replicationFactor: 3\n  configs:\n    cleanup.policy: compact\n',
    );
  });

  it('writes into flow maps', () => {
    expect(setFields('spec: { partitions: 1 }\n', ['spec'], { replicationFactor: 2 })).toBe(
      'spec: { partitions: 1, replicationFactor: 2 }\n',
    );
  });
});
