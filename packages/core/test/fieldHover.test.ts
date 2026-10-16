import { describe, expect, it } from 'vitest';
import { fieldHover, kindHover, markdownCode } from '../src/fieldDocs/hover';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { snapshotCatalog, snapshotDoc } from './fixtures';

const schema = buildResourceSchema(snapshotDoc, snapshotCatalog);
const topic = {
  apiVersion: 'v2',
  kind: 'Topic',
  metadata: { name: 't', cluster: 'local-kafka' },
  spec: { partitions: 1, replicationFactor: 1 },
};

describe('fieldHover', () => {
  it("gives a field's path, type, whether it is required, its docs and a link", () => {
    const hover = fieldHover(schema, snapshotCatalog, topic, ['spec', 'partitions']);
    expect(hover).toMatch(/^\*\*`spec\.partitions`\*\* · integer · required/);
    expect(hover).toMatch(/\[Docs\]\(https:\/\/docs\.conduktor\.io\//);
  });

  it('adds the line an editor gives about where a reference points', () => {
    const hover = fieldHover(
      schema,
      snapshotCatalog,
      topic,
      ['metadata', 'cluster'],
      'References KafkaCluster `local-kafka`: on the Console',
    );
    expect(hover).toMatch(/valid Kafka cluster/);
    expect(hover).toMatch(/References KafkaCluster `local-kafka`: on the Console\n\n\[Docs\]/);
  });

  it('summarises a kind, with its docs', () => {
    expect(kindHover('Topic')).toMatch(
      /^\*\*Topic\*\* — [\s\S]*docs\.conduktor\.io\/guide\/reference\/kafka-reference#topic/,
    );
  });

  it('fences a value so its backticks cannot end the code span', () => {
    expect(markdownCode('a`b')).toBe('``a`b``');
  });
});
