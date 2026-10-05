import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { fromTemplate, templateDocument, templateName } from '../src/templates';

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
  it('keeps the template exactly as written, apart from the name and parents', () => {
    const styled = [
      'apiVersion: v2',
      'kind: Topic',
      'metadata:',
      '    name: orders',
      '    labels:',
      '        owner: data',
      'spec:',
      '    partitions: 0x1F',
      '    configs:',
      '        description: ' + 'a long line that goes on and on '.repeat(4).trim(),
      'list:',
      '- a',
      '',
      '',
      '# end',
      '',
    ].join('\n');
    const out = fromTemplate(templateDocument(styled, 'Topic')!.text, { cluster: 'local' }, 'orders-2');
    expect(out).toBe(styled.replace('    name: orders', '    name: orders-2\n    cluster: local'));
  });

  it('adds missing parents to flow metadata and replaces existing ones in place', () => {
    const flow = 'kind: Topic\nmetadata: { name: a, labels: { x: y } }\nspec: {}\n';
    expect(fromTemplate(flow, { cluster: 'c' }, 'b')).toBe(
      'kind: Topic\nmetadata: { name: b, labels: { x: y }, cluster: c }\nspec: {}\n',
    );
    const block = 'kind: Topic\nmetadata:\n  cluster: old # keep this note\n  name: a\n';
    expect(fromTemplate(block, { cluster: 'new' }, 'b')).toBe(
      'kind: Topic\nmetadata:\n  cluster: new # keep this note\n  name: b\n',
    );
  });

  it('copes with empty metadata and refuses an aliased one', () => {
    expect(fromTemplate('kind: Topic\nmetadata:\n# nothing yet\nspec: {}\n', { cluster: 'c' }, 'n')).toMatch(
      /metadata:\n {2}name: n\n {2}cluster: c\n/,
    );
    expect(templateDocument('base: &m { name: a }\nkind: Topic\nmetadata: *m\n', 'Topic')).toBeUndefined();
  });

  it('starts a later document without its separator, comment kept', () => {
    const text = 'kind: Application\nmetadata: { name: a }\n---\n# the topic\nkind: Topic\nmetadata: { name: t }\n';
    expect(templateDocument(text, 'Topic')!.text).toBe('# the topic\nkind: Topic\nmetadata: { name: t }\n');
  });

  it('names a kind limited to fixed names by its template when free, never by another', () => {
    const fixed = ['Email', 'Slack', 'Teams'];
    expect(templateName('Slack', fixed, new Set())).toBe('Slack');
    expect(templateName('Slack', fixed, new Set(['Slack']))).toBeUndefined();
    expect(templateName('custom', fixed, new Set(['Email']))).toBe('Slack');
    expect(templateName('orders', undefined, new Set())).toBe('orders');
  });

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
