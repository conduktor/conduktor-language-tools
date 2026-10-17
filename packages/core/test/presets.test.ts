import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Resource } from '../src/resources/types';
import { applyPreset, presetFromTemplate, TOPIC_PRESETS } from '../src/topicConfigs/presets';
import { checkTopicConfig } from '../src/topicConfigs/check';
import { at } from './fixtures';

describe('topic presets', () => {
  it('offers the common profiles, every value valid', () => {
    expect(TOPIC_PRESETS.map((p) => p.id)).toEqual([
      'high-throughput',
      'durable',
      'compacted',
      'short-retention',
      'long-retention',
    ]);
    for (const preset of TOPIC_PRESETS)
      for (const [key, value] of Object.entries(preset.configs))
        expect(checkTopicConfig(key, value), `${preset.id} ${key}`).toBeUndefined();
    // Topic-level compression makes the broker recompress whatever producers send.
    expect(TOPIC_PRESETS.filter((p) => 'compression.type' in p.configs)).toEqual([]);
  });

  it('applies a preset to a topic, keeping what it does not set', () => {
    const topic =
      'kind: Topic\nmetadata: { name: t }\nspec:\n  partitions: 1 # small\n  configs:\n    segment.bytes: "1073741824"\n';
    const text = applyPreset(
      topic,
      TOPIC_PRESETS.find((p) => p.id === 'compacted')!,
    );
    const value: unknown = parse(text);
    expect(at(value, 'spec', 'configs', 'cleanup.policy')).toBe('compact');
    expect(at(value, 'spec', 'configs', 'segment.bytes')).toBe('1073741824');
    expect(text).toContain('partitions: 1 # small');
  });

  it('turns a Console TopicTemplate into a preset, configs or not', () => {
    const template = {
      apiVersion: 'v2',
      kind: 'TopicTemplate',
      metadata: { name: 'small' },
      spec: {
        displayName: 'Small',
        description: 'One partition',
        defaults: { spec: { partitions: 1, replicationFactor: 3 } },
      },
    } as Resource;
    expect(presetFromTemplate(template)).toEqual({
      id: 'template:small',
      label: 'Small',
      detail: 'One partition',
      partitions: 1,
      replicationFactor: 3,
      configs: {},
    });
  });

  it('applies a preset to a topic whose spec or configs are still empty', () => {
    const compacted = TOPIC_PRESETS.find((p) => p.id === 'compacted')!;
    for (const text of ['kind: Topic\nspec:\n', 'kind: Topic\nspec:\n  configs:\n'])
      expect(at(parse(applyPreset(text, compacted)), 'spec', 'configs')).toEqual(compacted.configs);
  });

  it('replaces a commented value and keeps its comment', () => {
    const text = 'kind: Topic\nspec:\n  configs:\n    retention.ms: "1" # keep\n';
    const short = TOPIC_PRESETS.find((p) => p.id === 'short-retention')!;
    expect(applyPreset(text, short)).toContain('retention.ms: "86400000" # keep');
  });
});
