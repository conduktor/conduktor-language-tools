import { describe, expect, it } from 'vitest';
import { parseKafkaTopicConfigs, topicConfig, TOPIC_CONFIGS } from '../src/topicConfigs';

const page = `<ul><li><h4><a id=cleanup.policy></a><a id=topicconfigs_cleanup.policy href=#topicconfigs_cleanup.policy>cleanup.policy</a></h4><p>Designates the <code>delete</code> or <a href=#compaction>compact</a> policy.</p><table><tbody><tr><th>Type:</th><td>list</td></tr><tr><th>Default:</th><td>delete</td></tr><tr><th>Valid Values:</th><td>[compact, delete]</td></tr><tr><th>Server Default Property:</th><td>log.cleanup.policy</td></tr><tr><th>Importance:</th><td>medium</td></tr></tbody></table></li></ul>`;

describe('topic configs', () => {
  it('reads keys, docs, types, defaults and valid values from the Kafka docs', () => {
    expect(parseKafkaTopicConfigs(page, 'https://kafka.apache.org/42/configuration/topic-configs/')).toEqual([
      {
        key: 'cleanup.policy',
        doc: 'Designates the delete or compact policy.',
        type: 'list',
        default: 'delete',
        validValues: '[compact, delete]',
        importance: 'medium',
        url: 'https://kafka.apache.org/42/configuration/topic-configs/#topicconfigs_cleanup.policy',
      },
    ]);
  });

  it('ships Kafka 4.2 and the Confluent keys', () => {
    expect(TOPIC_CONFIGS.length).toBeGreaterThan(50);
    expect(topicConfig('retention.ms')).toMatchObject({ type: 'long', default: '604800000', defaultNote: '7 days' });
    expect(topicConfig('confluent.value.schema.validation')?.url).toContain('#confluent-value-schema-validation');
    expect(topicConfig('no.such.config')).toBeUndefined();
  });
});
