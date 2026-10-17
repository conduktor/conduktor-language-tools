import { describe, expect, it } from 'vitest';
import { fieldDocs, kindDoc } from '../src/fieldDocs/lookup';

const texts = (kind: string, path: (string | number)[]) => fieldDocs(kind, path).map((d) => d.text);

describe('field docs lookup', () => {
  it('finds a field by its path', () => {
    expect(texts('KafkaCluster', ['spec', 'icon']).join()).toMatch(/Icon Sets/);
    expect(fieldDocs('KafkaCluster', ['spec', 'icon'])[0]!.url).toMatch(/console-reference#kafkacluster$/);
  });

  it('reads a relative or shortened docs path, and list indexes as []', () => {
    expect(texts('PartnerZone', ['spec', 'topics', 0, 'backingTopic']).join()).toMatch(/internal name/);
    expect(texts('KafkaCluster', ['spec', 'schemaRegistry', 'security', 'type']).join()).toMatch(/BasicAuth/);
  });

  it('never spreads a one-segment docs path to nested fields', () => {
    for (const doc of fieldDocs('KafkaCluster', ['spec', 'kafkaFlavor', 'type']))
      expect(doc.path).toMatch(/kafkaFlavor/);
    expect(fieldDocs('KafkaCluster', ['spec', 'nothing', 'here'])).toEqual([]);
  });

  it('summarises documented kinds only', () => {
    expect(kindDoc('Group')?.url).toMatch(/#consolegroup$/);
    expect(kindDoc('ChargebackLabel')).toBeUndefined();
  });
});
