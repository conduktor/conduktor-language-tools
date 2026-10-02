import { describe, expect, it } from 'vitest';
import { itemPath, listPath, MissingParentError, parentsOf, resourcePath, upsertTarget } from '../src/openapi/paths';
import { snapshotCatalog } from './fixtures';

const topic = snapshotCatalog.latest('Topic')!;
const connector = snapshotCatalog.latest('Connector')!;
const alertV3 = snapshotCatalog.resolve('v3', 'Alert')!;

describe('paths', () => {
  it('fills parent path params', () => {
    expect(listPath(connector, { cluster: 'prod', connectCluster: 'main' })).toBe(
      '/public/kafka/v2/cluster/prod/connect/main/connector',
    );
  });

  it('encodes names and parents with spaces, dots, # and %', () => {
    expect(itemPath(topic, { cluster: 'my cluster' }, 'orders.v1#%')).toBe(
      '/public/kafka/v2/cluster/my%20cluster/topic/orders.v1%23%25',
    );
  });

  it('names the missing parent', () => {
    expect(() => listPath(topic, {})).toThrow(new MissingParentError('metadata.cluster is required for Topic'));
  });

  it('builds the upsert target from metadata, including query parents', () => {
    expect(upsertTarget(topic, { apiVersion: 'v2', kind: 'Topic', metadata: { name: 't', cluster: 'local' } })).toEqual(
      { path: '/public/kafka/v2/cluster/local/topic', query: {} },
    );
    expect(upsertTarget(alertV3, { apiVersion: 'v3', kind: 'Alert', metadata: { name: 'a', group: 'ops' } })).toEqual({
      path: '/public/monitoring/v3/alert',
      query: { group: 'ops' },
    });
  });

  it('maps a partial parent chain onto param names', () => {
    expect(parentsOf(connector, ['prod'])).toEqual({ cluster: 'prod' });
  });

  it('finds a resource by the parents in its own metadata', () => {
    expect(
      resourcePath(connector, {
        apiVersion: 'v2',
        kind: 'Connector',
        metadata: { name: 'sink a', cluster: 'prod', connectCluster: 'main' },
      }),
    ).toBe('/public/kafka/v2/cluster/prod/connect/main/connector/sink%20a');
  });
});
