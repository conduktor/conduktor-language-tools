import { describe, expect, it } from 'vitest';
import { referencingKinds, referrersOf } from '../src/references/reverse';
import { snapshotCatalog } from './fixtures';

const app = {
  apiVersion: 'v1',
  kind: 'Application',
  metadata: { name: 'shop' },
  spec: { title: 'S', owner: 'team-a' },
};
const instance = {
  apiVersion: 'v1',
  kind: 'ApplicationInstance',
  metadata: { name: 'shop-dev', application: 'shop' },
  spec: { cluster: 'local', resources: [{ type: 'TOPIC', name: 'orders.', patternType: 'PREFIXED' }] },
};
const group = {
  apiVersion: 'v2',
  kind: 'Group',
  metadata: { name: 'readers' },
  spec: {
    permissions: [
      { resourceType: 'TOPIC', cluster: '*', name: 'orders.v2', patternType: 'LITERAL', permissions: ['topicConsume'] },
      { resourceType: 'TOPIC', cluster: 'prod', name: '*', patternType: 'LITERAL', permissions: ['topicConsume'] },
    ],
  },
};
const indexed = { apiVersion: 'v1', kind: 'IndexedTopic', metadata: { name: 'orders.v2', cluster: 'local' }, spec: {} };
const resources = [app, instance, group, indexed];
const how = (target: Parameters<typeof referrersOf>[0]) =>
  referrersOf(target, resources, snapshotCatalog).map((r) => [r.index, r.reference.path.join('.'), r.how]);

describe('referrersOf', () => {
  it('finds what names a resource', () => {
    expect(how({ kind: 'Group', parents: [], name: 'team-a' })).toEqual([[0, 'spec.owner', 'names']]);
    expect(how({ kind: 'Application', parents: [], name: 'shop' })).toEqual([[1, 'metadata.application', 'names']]);
  });

  it('finds patterns and wildcards that cover it, in its own scope only', () => {
    expect(how({ kind: 'Topic', parents: ['local'], name: 'orders.v2' })).toEqual([
      [1, 'spec.resources.0.name', 'matches'],
      [2, 'spec.permissions.0.name', 'names'],
      [3, 'metadata.name', 'names'],
    ]);
    expect(how({ kind: 'Topic', parents: ['prod'], name: 'orders.v2' })).toEqual([
      [2, 'spec.permissions.0.name', 'names'],
      [2, 'spec.permissions.1.name', 'covers'],
    ]);
  });

  it('finds nothing for a kind nothing refers to', () => {
    expect(how({ kind: 'Integration', parents: [], name: 'Slack' })).toEqual([]);
  });

  it('knows which kinds can refer to a kind', () => {
    expect(referencingKinds('Group')).toEqual(expect.arrayContaining(['Application', 'DataQualityPolicy']));
    expect(referencingKinds('Topic')).toEqual(
      expect.arrayContaining(['ApplicationInstance', 'ServiceAccount', 'Group', 'User', 'IndexedTopic']),
    );
    expect(referencingKinds('Integration')).toEqual([]);
  });
});
