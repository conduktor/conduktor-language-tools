import { describe, expect, it } from 'vitest';
import { kindSchema } from '../src/openapi/kindSchema';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { schemaAt } from '../src/openapi/schemaAt';
import type { JsonSchema } from '../src/openapi/types';
import { snapshotCatalog, snapshotDoc } from './fixtures';

const schema = buildResourceSchema(snapshotDoc, snapshotCatalog);
const rootOf = (kind: string) => kindSchema(schema, snapshotCatalog.latest(kind) as never) as JsonSchema;

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
});
