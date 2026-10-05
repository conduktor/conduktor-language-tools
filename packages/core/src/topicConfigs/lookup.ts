import snapshot from '../../snapshot/topic-configs.json';
import type { TopicConfigDoc } from './kafkaDocs';

export const TOPIC_CONFIGS: readonly TopicConfigDoc[] = snapshot.configs;
const byKey = new Map(TOPIC_CONFIGS.map((config) => [config.key, config]));

export function topicConfig(key: string): TopicConfigDoc | undefined {
  return byKey.get(key);
}

/** A value as YAML Console sends unchanged: a safe int or long plain, anything else a string. */
export function configValueYaml(key: string, value: string): string {
  const type = topicConfig(key)?.type;
  const whole = (type === 'int' || type === 'long') && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value));
  return whole ? value : JSON.stringify(value);
}
