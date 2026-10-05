import snapshot from '../../snapshot/topic-configs.json';
import type { TopicConfigDoc } from './kafkaDocs';

export { parseKafkaTopicConfigs, type TopicConfigDoc } from './kafkaDocs';

export const TOPIC_CONFIGS: readonly TopicConfigDoc[] = snapshot.configs;
const byKey = new Map(TOPIC_CONFIGS.map((config) => [config.key, config]));

export function topicConfig(key: string): TopicConfigDoc | undefined {
  return byKey.get(key);
}
