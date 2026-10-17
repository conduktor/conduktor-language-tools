import { describe, expect, it } from 'vitest';
import { sortForApply } from '../src/resources/ordering';
import type { Resource } from '../src/resources/types';
import { snapshotCatalog } from './fixtures';

const r = (kind: string): { resource: Resource } => ({
  resource: { apiVersion: 'v1', kind, metadata: { name: kind } },
});

describe('sortForApply', () => {
  it('orders by the catalog, keeps file order within a kind, and puts unparsed documents first', () => {
    const items: { resource?: Resource }[] = [r('Topic'), r('Application'), {}, r('KafkaCluster'), r('Topic')];
    const sorted = sortForApply(items, snapshotCatalog);
    expect(sorted.map((i) => i.resource?.kind)).toEqual([undefined, 'KafkaCluster', 'Application', 'Topic', 'Topic']);
    expect(sorted[3]).toBe(items[0]);
  });
});
