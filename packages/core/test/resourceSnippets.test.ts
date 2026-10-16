import { describe, expect, it } from 'vitest';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import { resourceSnippets } from '../src/templates';
import { snapshotCatalog, snapshotDoc } from './fixtures';

const schema = buildResourceSchema(snapshotDoc, snapshotCatalog);

describe('resourceSnippets', () => {
  it('gives every kind a whole resource at its latest version, with a tab stop on its name', () => {
    const topic = resourceSnippets(snapshotCatalog, schema, []).find((s) => s.kind === 'Topic' && !s.variant)!;
    expect(topic.snippet).toMatch(/^apiVersion: v2\nkind: Topic\nmetadata:\n {2}name: \$\{1:[^}]+\}/);
    expect(topic.snippet).toMatch(/partitions:/);
    expect(topic.detail).toBe('kafka · v2');
  });

  it('offers the known clusters as a choice, the first one inserted by default', () => {
    const topic = resourceSnippets(snapshotCatalog, schema, ['local', 'prod']).find((s) => s.kind === 'Topic')!;
    expect(topic.snippet).toMatch(/cluster: \$\{\d+\|local,prod\|\}/);
  });

  it('labels the variants of a kind whose spec is a union', () => {
    const clusters = resourceSnippets(snapshotCatalog, schema, []).filter((s) => s.kind === 'KafkaCluster');
    expect(clusters.length).toBeGreaterThan(1);
    expect(clusters.filter((s) => s.variant).map((s) => s.variant)).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );
  });
});
