import type { Resource } from '../resources/types';
import { setFields } from '../resources/setFields';
import { isRecord } from '../util';

export interface TopicPreset {
  id: string;
  label: string;
  detail: string;
  partitions?: number;
  replicationFactor?: number;
  configs: Record<string, string>;
}

export const TOPIC_PRESETS: readonly TopicPreset[] = [
  {
    id: 'high-throughput',
    label: 'High throughput',
    detail: 'Many partitions to spread the load, two in-sync replicas, a week of retention.',
    partitions: 12,
    replicationFactor: 3,
    configs: { 'min.insync.replicas': '2', 'retention.ms': '604800000' },
  },
  {
    id: 'durable',
    label: 'Durable',
    detail: 'Three replicas, a write acknowledged by two of them, and no unclean leader elections.',
    replicationFactor: 3,
    configs: { 'min.insync.replicas': '2', 'unclean.leader.election.enable': 'false' },
  },
  {
    id: 'compacted',
    label: 'Compacted (latest value per key)',
    detail: 'Keeps the latest value for each key, for state and changelog topics.',
    configs: { 'cleanup.policy': 'compact', 'min.cleanable.dirty.ratio': '0.1', 'segment.ms': '3600000' },
  },
  {
    id: 'short-retention',
    label: 'Short retention (1 day)',
    detail: 'Deletes data after a day.',
    configs: { 'retention.ms': '86400000', 'cleanup.policy': 'delete' },
  },
  {
    id: 'long-retention',
    label: 'Long retention (30 days)',
    detail: 'Deletes data after thirty days.',
    configs: { 'retention.ms': '2592000000', 'cleanup.policy': 'delete' },
  },
];

/** A Console TopicTemplate as a preset: its defaults' partitions, replication and configs. */
export function presetFromTemplate(template: Resource): TopicPreset | undefined {
  const spec = isRecord(template.spec) ? template.spec : {};
  const defaults = isRecord(spec.defaults) && isRecord(spec.defaults.spec) ? spec.defaults.spec : undefined;
  if (!defaults) return undefined;
  const configs = isRecord(defaults.configs) ? defaults.configs : {};
  return {
    id: `template:${template.metadata.name}`,
    label: typeof spec.displayName === 'string' ? spec.displayName : template.metadata.name,
    detail:
      typeof spec.description === 'string' ? spec.description : `Console topic template ${template.metadata.name}`,
    ...(typeof defaults.partitions === 'number' && { partitions: defaults.partitions }),
    ...(typeof defaults.replicationFactor === 'number' && { replicationFactor: defaults.replicationFactor }),
    configs: Object.fromEntries(Object.entries(configs).map(([key, value]) => [key, String(value)])),
  };
}

/** The topic document with the preset's partitions, replication and configs set, the rest as written. */
export function applyPreset(text: string, preset: TopicPreset): string {
  const sizing = {
    ...(preset.partitions !== undefined && { partitions: preset.partitions }),
    ...(preset.replicationFactor !== undefined && { replicationFactor: preset.replicationFactor }),
  };
  const sized = Object.keys(sizing).length > 0 ? setFields(text, ['spec'], sizing) : text;
  return Object.keys(preset.configs).length > 0 ? setFields(sized, ['spec', 'configs'], preset.configs) : sized;
}
