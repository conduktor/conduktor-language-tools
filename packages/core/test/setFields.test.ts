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

  it('writes into flow maps, a missing map included', () => {
    expect(setFields('spec: { partitions: 1 }\n', ['spec'], { replicationFactor: 2 })).toBe(
      'spec: { partitions: 1, replicationFactor: 2 }\n',
    );
    expect(setFields('spec: { partitions: 1 }\n', ['spec', 'configs'], { 'cleanup.policy': 'compact' })).toBe(
      'spec: { partitions: 1, configs: { cleanup.policy: compact } }\n',
    );
  });

  it('fills an empty map', () => {
    expect(setFields('kind: Topic\nspec:\n', ['spec'], { partitions: 3 })).toBe(
      'kind: Topic\nspec:\n  partitions: 3\n',
    );
    expect(setFields('spec: # later\n  \nkind: Topic\n', ['spec', 'configs'], { 'cleanup.policy': 'compact' })).toBe(
      'spec: # later\n  configs:\n    cleanup.policy: compact\n  \nkind: Topic\n',
    );
    expect(setFields('spec:\n  configs:\n', ['spec', 'configs'], { 'retention.ms': '1' })).toBe(
      'spec:\n  configs:\n    retention.ms: "1"\n',
    );
  });

  it('gives a key with no value one', () => {
    expect(setFields('spec:\n  configs:\n    retention.ms:\n', ['spec', 'configs'], { 'retention.ms': '1' })).toBe(
      'spec:\n  configs:\n    retention.ms: "1"\n',
    );
  });

  it('quotes list values written into a flow map', () => {
    const text = setFields('spec: { configs: { retention.ms: 1 } }\n', ['spec', 'configs'], {
      'retention.ms': 'a,b',
      'cleanup.policy': 'compact,delete',
    });
    expect(text).toBe('spec: { configs: { retention.ms: "a,b", cleanup.policy: "compact,delete" } }\n');
  });

  it('re-serialises only when no line can take the new key', () => {
    expect(setFields('items:\n  - configs:\n      a: b\n', ['items', '0'], { partitions: 3 })).toBe(
      'items:\n  - configs:\n      a: b\n    partitions: 3\n',
    );
  });

  it('inserts before a nested map when there is no one-line field, rather than reformatting', () => {
    const text = "metadata: {name: t, cluster: 'c'}\nspec:\n  configs:\n    a: b\n";
    expect(setFields(text, ['spec'], { partitions: 3 })).toBe(
      "metadata: {name: t, cluster: 'c'}\nspec:\n  partitions: 3\n  configs:\n    a: b\n",
    );
    expect(setFields('spec:\n  configs:\n    a: b\n', ['spec'], { labels: { team: 'x' } })).toBe(
      'spec:\n  labels:\n    team: x\n  configs:\n    a: b\n',
    );
  });
});
