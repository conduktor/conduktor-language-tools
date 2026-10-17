import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { KindVersion } from '../src/openapi/kindCatalog';
import { comparableYaml, newResourceYaml } from '../src/resources/yamlText';
import { at, snapshotCatalog } from './fixtures';

describe('newResourceYaml', () => {
  it('starts from the published example with the chosen parents filled in', () => {
    const topic: unknown = parse(newResourceYaml(snapshotCatalog.latest('Topic')!, { cluster: 'local-kafka' }));
    expect(topic).toMatchObject({
      apiVersion: 'v2',
      kind: 'Topic',
      metadata: { name: 'my-topic', cluster: 'local-kafka' },
    });
    expect(at(topic, 'spec')).toMatchObject({ partitions: 1 });
  });

  it('takes the name it is given in place of the example name', () => {
    const topic: unknown = parse(
      newResourceYaml(snapshotCatalog.latest('Topic')!, { cluster: 'local-kafka' }, 'my-topic-2'),
    );
    expect(at(topic, 'metadata')).toMatchObject({ name: 'my-topic-2', cluster: 'local-kafka' });
  });

  it('fills every parent of a nested kind', () => {
    const connector: unknown = parse(
      newResourceYaml(snapshotCatalog.latest('Connector')!, { cluster: 'local-kafka', connectCluster: 'main' }),
    );
    expect(at(connector, 'metadata')).toMatchObject({ cluster: 'local-kafka', connectCluster: 'main' });
  });

  it('writes a skeleton for a kind without an example', () => {
    const kind: KindVersion = {
      kind: 'ThingPolicy',
      version: 1,
      group: 'x',
      order: 1,
      listPath: '/public/x/v1/cluster/{cluster}/thing-policy',
      parentPathParams: ['cluster'],
      parentQueryParams: [],
    };
    expect(parse(newResourceYaml(kind, { cluster: 'c' }))).toEqual({
      apiVersion: 'v1',
      kind: 'ThingPolicy',
      metadata: { name: 'my-thing-policy', cluster: 'c' },
      spec: {},
    });
  });
});

describe('comparableYaml', () => {
  it('puts the resource identity first and sorts everything else, so key order never shows up in a diff', () => {
    const a = comparableYaml({
      spec: { replicationFactor: 1, partitions: 3, configs: { 'retention.ms': '1', 'cleanup.policy': 'delete' } },
      metadata: { cluster: 'local', name: 'orders' },
      kind: 'Topic',
      apiVersion: 'v2',
    });
    const b = comparableYaml({
      apiVersion: 'v2',
      kind: 'Topic',
      metadata: { name: 'orders', cluster: 'local' },
      spec: { partitions: 3, configs: { 'cleanup.policy': 'delete', 'retention.ms': '1' }, replicationFactor: 1 },
    });
    expect(a).toBe(b);
    expect(a.split('\n').slice(0, 4)).toEqual(['apiVersion: v2', 'kind: Topic', 'metadata:', '  cluster: local']);
  });
});
