import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Resource } from '../src/resources/types';
import { applyPreset, checkTopicConfig, presetFromTemplate, TOPIC_PRESETS } from '../src/topicConfigs';

describe('topic presets', () => {
  it('offers the common profiles, every value valid', () => {
    expect(TOPIC_PRESETS.map((p) => p.id)).toEqual([
      'high-throughput',
      'low-latency',
      'compacted',
      'short-retention',
      'long-retention',
    ]);
    for (const preset of TOPIC_PRESETS)
      for (const [key, value] of Object.entries(preset.configs))
        expect(checkTopicConfig(key, value), `${preset.id} ${key}`).toBeUndefined();
  });

  it('applies a preset to a topic, keeping what it does not set', () => {
    const topic =
      'kind: Topic\nmetadata: { name: t }\nspec:\n  partitions: 1 # small\n  configs:\n    segment.bytes: "1073741824"\n';
    const text = applyPreset(
      topic,
      TOPIC_PRESETS.find((p) => p.id === 'compacted')!,
    );
    const value = parse(text);
    expect(value.spec.configs['cleanup.policy']).toBe('compact');
    expect(value.spec.configs['segment.bytes']).toBe('1073741824');
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
});
