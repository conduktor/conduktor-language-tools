// Regenerates packages/core/snapshot/topic-configs.json: `node scripts/refresh-topic-configs.ts`.
import { writeFileSync } from 'node:fs';
import { parseKafkaTopicConfigs, type TopicConfigDoc } from '../packages/core/src/topicConfigs/kafkaDocs.ts';

const KAFKA = '4.2';
const SOURCE = `https://kafka.apache.org/${KAFKA.replace('.', '')}/configuration/topic-configs/`;
const CONFLUENT_DOCS = 'https://docs.confluent.io/platform/current/installation/configuration/topic-configs.html';

// From the Console's source
// (confluentDefaultValues); Confluent publishes no machine-readable list.
const CONFLUENT: Record<string, string> = {
  'confluent.key.schema.validation': 'false',
  'confluent.key.subject.name.strategy': 'io.confluent.kafka.serializers.subject.TopicNameStrategy',
  'confluent.value.schema.validation': 'false',
  'confluent.value.subject.name.strategy': 'io.confluent.kafka.serializers.subject.TopicNameStrategy',
  'confluent.context.name': '',
  'confluent.schema.validation.context.name': 'default',
  'confluent.tier.enable': 'false',
  'confluent.tier.local.hotset.bytes': '-1',
  'confluent.tier.local.hotset.ms': '86400000',
  'confluent.tier.cleaner.min.cleanable.ratio': '0.75',
  'confluent.tier.cleaner.compact.segment.min.bytes': '20971520',
  'confluent.tier.cleaner.dual.compaction': 'false',
  'confluent.tier.cleaner.compact.min.efficiency': '0.5',
  'confluent.tier.cleaner.enable': 'false',
  'confluent.tier.segment.hotset.roll.min.bytes': '104857600',
  'confluent.prefer.tier.fetch.ms': '-1',
  'confluent.cluster.link.allow.legacy.message.format': 'false',
  'confluent.allow.mirror.v0v1.format': 'false',
  'confluent.placement.constraints': '',
  'confluent.segment.speculative.prefetch.enable': 'false',
};

const response = await fetch(SOURCE);
if (!response.ok) throw new Error(`${SOURCE}: ${response.status}`);
const kafka = parseKafkaTopicConfigs(await response.text(), SOURCE);
if (kafka.length < 20) throw new Error(`Only ${kafka.length} configs found on ${SOURCE}; has the page changed?`);
const confluent: TopicConfigDoc[] = Object.entries(CONFLUENT).map(([key, value]) => ({
  key,
  doc: 'Confluent Platform topic config.',
  type: 'string',
  ...(value !== '' && { default: value }),
  url: `${CONFLUENT_DOCS}#${key.replace(/\./g, '-')}`,
}));
const configs = [...kafka, ...confluent].sort((a, b) => a.key.localeCompare(b.key));
writeFileSync(
  new URL('../packages/core/snapshot/topic-configs.json', import.meta.url),
  `${JSON.stringify({ kafka: KAFKA, source: SOURCE, configs }, null, 2)}\n`,
);
console.log(`Wrote ${configs.length} topic configs (${kafka.length} from Kafka ${KAFKA}).`);
