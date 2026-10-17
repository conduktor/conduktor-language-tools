import { describe, expect, it } from 'vitest';
import { schemaAt } from '../src/openapi/schemaAt';
import { rootOf } from './fixtures';

describe('schemaAt', () => {
  it('says the type, whether it is required and the allowed values', () => {
    expect(schemaAt(rootOf('Topic'), {}, ['spec', 'partitions'])).toMatchObject({ type: 'integer', required: true });
    expect(schemaAt(rootOf('KafkaCluster'), {}, ['spec', 'kafkaFlavor', 'type'])?.type).toMatch(/^one of .*Confluent/);
  });

  it('follows the variant the document chose', () => {
    const value = { spec: { kafkaFlavor: { type: 'Confluent' } } };
    expect(schemaAt(rootOf('KafkaCluster'), value, ['spec', 'kafkaFlavor', 'key'])).toMatchObject({ type: 'string' });
    const gateway = { spec: { kafkaFlavor: { type: 'Gateway' } } };
    expect(schemaAt(rootOf('KafkaCluster'), gateway, ['spec', 'kafkaFlavor', 'key'])).toBeUndefined();
  });

  it('walks into list items', () => {
    expect(schemaAt(rootOf('Group'), {}, ['spec', 'permissions', 0, 'resourceType'])?.type).toMatch(/^one of /);
    expect(schemaAt(rootOf('Group'), {}, ['spec', 'permissions'])?.type).toBe('list of object');
  });

  it('reads an untagged list item by the option its value names', () => {
    const topic = { spec: { permissions: [{ resourceType: 'TOPIC' }] } };
    const permissions = schemaAt(rootOf('Group'), topic, ['spec', 'permissions', 0, 'permissions']);
    expect(permissions?.type).toMatch(/^list of one of .*topicConsume/);
    expect(permissions?.type).not.toMatch(/clusterViewBroker/);
    const platform = { spec: { permissions: [{ resourceType: 'PLATFORM' }] } };
    expect(schemaAt(rootOf('Group'), platform, ['spec', 'permissions', 0, 'cluster'])).toBeUndefined();
  });
});
