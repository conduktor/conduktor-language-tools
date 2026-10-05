import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { fromTemplate, templateDocument } from '../src/templates';

const template = `# Our standard high-throughput topic
apiVersion: v2
kind: Topic
metadata:
  name: high-throughput # renamed on use
  cluster: placeholder
  labels: { team: data }
spec:
  partitions: 24
  replicationFactor: 3
  configs:
    retention.ms: "604800000" # a week
`;

describe('templates', () => {
  it('finds the document of a kind in a template file', () => {
    const mixed = `apiVersion: v1\nkind: Application\nmetadata: { name: a }\n---\n${template}`;
    expect(templateDocument(mixed, 'Topic')).toMatchObject({ name: 'high-throughput' });
    expect(templateDocument('kind: [', 'Topic')).toBeUndefined();
    expect(templateDocument(template, 'Group')).toBeUndefined();
  });

  it('sets the name and parents and keeps everything else, comments included', () => {
    const text = fromTemplate(
      templateDocument(template, 'Topic')!.text,
      { cluster: 'local-kafka' },
      'high-throughput-2',
    );
    expect(parse(text)).toEqual({
      apiVersion: 'v2',
      kind: 'Topic',
      metadata: { name: 'high-throughput-2', cluster: 'local-kafka', labels: { team: 'data' } },
      spec: { partitions: 24, replicationFactor: 3, configs: { 'retention.ms': '604800000' } },
    });
    expect(text).toContain('# Our standard high-throughput topic');
    expect(text).toContain('# a week');
    expect(text).toContain('labels: { team: data }');
  });
});
