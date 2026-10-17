import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { Resource } from '../src/resources/types';
import { syncPath } from '../src/sync/paths';
import { withSecretPlaceholders } from '../src/sync/placeholders';
import { driftOf, syncStatus } from '../src/sync/status';
import { snapshotCatalog } from './fixtures';

const topic: Resource = {
  apiVersion: 'v2',
  kind: 'Topic',
  metadata: { name: 'orders', cluster: 'local' },
  spec: { partitions: 3, configs: { 'retention.ms': '1' } },
};

describe('syncPath', () => {
  it('mirrors the Explorer: global or the cluster, then group, kind and name', () => {
    expect(syncPath(snapshotCatalog.latest('Topic')!, ['local'], 'orders')).toBe(
      'clusters/local/kafka/Topic/orders.yaml',
    );
    expect(syncPath(snapshotCatalog.latest('Connector')!, ['local', 'main'], 'sink')).toBe(
      'clusters/local/kafka/Connector/main/sink.yaml',
    );
    expect(syncPath(snapshotCatalog.latest('Application')!, [], 'shop')).toBe(
      'global/self-serve/Application/shop.yaml',
    );
  });

  it('keeps every name inside its own path segment on any filesystem', () => {
    expect(syncPath(snapshotCatalog.latest('Application')!, [], 'a/b\\c:d*e?"<>|%')).toBe(
      'global/self-serve/Application/a%2Fb%5Cc%3Ad%2Ae%3F%22%3C%3E%7C%25.yaml',
    );
    expect(syncPath(snapshotCatalog.latest('Topic')!, ['..'], '.')).toBe('clusters/%2E%2E/kafka/Topic/%2E.yaml');
  });
});

describe('syncStatus', () => {
  const base = stringify(topic);

  it('is new without a base, in sync when equal, modified otherwise', () => {
    expect(syncStatus(base, undefined)).toBe('new');
    expect(syncStatus(base, base)).toBe('synced');
    expect(syncStatus(stringify({ ...topic, spec: { partitions: 6 } }), base)).toBe('modified');
  });

  it('ignores key order, formatting and comments', () => {
    const reordered = `# orders
spec:
  configs: { retention.ms: "1" }
  partitions: 3
metadata: { cluster: local, name: orders }
kind: Topic
apiVersion: v2
`;
    expect(syncStatus(reordered, base)).toBe('synced');
  });

  it('sees an edited secret, since both sides hold what the user wrote', () => {
    const cluster: Resource = {
      apiVersion: 'v2',
      kind: 'KafkaCluster',
      metadata: { name: 'prod' },
      spec: { bootstrapServers: 'k', kafkaFlavor: { type: 'Gateway', password: '${CDK_SECRET_P}' } },
    };
    const rotated = {
      ...cluster,
      spec: { ...(cluster.spec as object), kafkaFlavor: { type: 'Gateway', password: 'new' } },
    };
    expect(syncStatus(stringify(rotated), stringify(cluster))).toBe('modified');
  });

  it('counts unparseable local text as modified', () => {
    expect(syncStatus('kind: [', base)).toBe('modified');
  });
});

describe('driftOf', () => {
  const cluster: Resource = {
    apiVersion: 'v2',
    kind: 'KafkaCluster',
    metadata: { name: 'prod' },
    spec: { bootstrapServers: 'k:9092', kafkaFlavor: { type: 'Gateway', url: 'u', user: 'a', password: 'real' } },
  };
  const { resource: synced } = withSecretPlaceholders(cluster, []);

  it('is nothing while the Console still matches the base, secrets aside', () => {
    expect(driftOf(stringify(synced), cluster)).toBeUndefined();
  });

  it('tells a resource changed on the Console from one deleted there', () => {
    expect(
      driftOf(stringify(synced), { ...cluster, spec: { ...(cluster.spec as object), bootstrapServers: 'k:9093' } }),
    ).toBe('changed');
    expect(driftOf(stringify(synced), undefined)).toBe('deleted');
  });
});

describe('withSecretPlaceholders', () => {
  it('names the parents, so same-named resources in different clusters get their own variables', () => {
    const connector = (cluster: string): Resource => ({
      apiVersion: 'v2',
      kind: 'Connector',
      metadata: { name: 'c', cluster, connectCluster: 'connect' },
      spec: { config: { password: 'p' } },
    });
    expect(withSecretPlaceholders(connector('a'), ['a', 'connect']).variables).toEqual([
      'CDK_SECRET_CONNECTOR_A_CONNECT_C_SPEC_CONFIG_PASSWORD',
    ]);
    expect(withSecretPlaceholders(connector('b'), ['b', 'connect']).variables).toEqual([
      'CDK_SECRET_CONNECTOR_B_CONNECT_C_SPEC_CONFIG_PASSWORD',
    ]);
  });

  it('replaces secret values with environment variables named after the resource and field', () => {
    const { resource, variables } = withSecretPlaceholders(
      {
        apiVersion: 'v2',
        kind: 'KafkaCluster',
        metadata: { name: 'local-gateway' },
        spec: {
          bootstrapServers: 'k:9092',
          properties: { 'sasl.jaas.config': 'secret jaas', 'security.protocol': 'SASL_SSL' },
          kafkaFlavor: { type: 'Gateway', user: 'admin', password: 'conduktor' },
        },
      },
      [],
    );
    expect(resource.spec).toEqual({
      bootstrapServers: 'k:9092',
      properties: {
        'sasl.jaas.config': '${CDK_SECRET_KAFKACLUSTER_LOCAL_GATEWAY_SPEC_PROPERTIES_SASL_JAAS_CONFIG}',
        'security.protocol': 'SASL_SSL',
      },
      kafkaFlavor: {
        type: 'Gateway',
        user: 'admin',
        password: '${CDK_SECRET_KAFKACLUSTER_LOCAL_GATEWAY_SPEC_KAFKAFLAVOR_PASSWORD}',
      },
    });
    expect(variables).toEqual([
      'CDK_SECRET_KAFKACLUSTER_LOCAL_GATEWAY_SPEC_PROPERTIES_SASL_JAAS_CONFIG',
      'CDK_SECRET_KAFKACLUSTER_LOCAL_GATEWAY_SPEC_KAFKAFLAVOR_PASSWORD',
    ]);
  });

  it('leaves resources without secrets as they are', () => {
    expect(withSecretPlaceholders(topic, ['local'])).toEqual({ resource: topic, variables: [] });
  });
});

describe('drift and server-managed fields', () => {
  const subject = (spec: Record<string, unknown>): Resource => ({
    apiVersion: 'v2',
    kind: 'Subject',
    metadata: { name: 's', cluster: 'c' },
    spec: { format: 'AVRO', schema: 'A', ...spec },
  });

  it('ignores what the Console fills in itself', () => {
    expect(driftOf(stringify(subject({})), subject({ id: 14, version: 1, guid: 'g' }))).toBeUndefined();
    const user: Resource = { apiVersion: 'v2', kind: 'User', metadata: { name: 'u' }, spec: {} };
    expect(driftOf(stringify(user), { ...user, metadata: { name: 'u', lastLoginDate: 'today' } })).toBeUndefined();
    const zone: Resource = {
      apiVersion: 'v2',
      kind: 'PartnerZone',
      metadata: { name: 'z' },
      spec: { displayName: 'Z' },
    };
    const recorded = { name: 'z', id: 'i', updatedAt: 'now', status: 'READY', failedReason: '' };
    expect(driftOf(stringify(zone), { ...zone, metadata: recorded })).toBeUndefined();
  });

  it('still sees a change to what was written', () => {
    expect(driftOf(stringify(subject({})), subject({ schema: 'B', id: 15, version: 2 }))).toBe('changed');
  });

  it("keeps what the user sets, such as a policy's group", () => {
    const policy: Resource = {
      apiVersion: 'v1',
      kind: 'DataQualityPolicy',
      metadata: { name: 'p', group: 'a' },
      spec: {},
    };
    expect(driftOf(stringify(policy), { ...policy, metadata: { name: 'p', group: 'b' } })).toBe('changed');
  });

  it('ignores the application labels the Console adds to what an application owns', () => {
    const topic: Resource = {
      apiVersion: 'v2',
      kind: 'Topic',
      metadata: { name: 't', cluster: 'c', labels: { team: 'a' } },
      spec: { partitions: 1, replicationFactor: 1 },
    };
    const owned = {
      ...topic,
      metadata: {
        ...topic.metadata,
        labels: { team: 'a', 'conduktor.io/application': 'app', 'conduktor.io/application-instance': 'app-dev' },
      },
    };
    expect(driftOf(stringify(topic), owned)).toBeUndefined();
    expect(driftOf(stringify(topic), { ...owned, metadata: { ...owned.metadata, labels: { team: 'b' } } })).toBe(
      'changed',
    );
  });

  it("reads a Topic's configs and defaulted replication the way the Console returns them", () => {
    const written: Resource = {
      apiVersion: 'v2',
      kind: 'Topic',
      metadata: { name: 't', cluster: 'c' },
      spec: { partitions: 1, configs: { 'retention.ms': 60000 } },
    };
    const live = { ...written, spec: { partitions: 1, replicationFactor: 3, configs: { 'retention.ms': '60000' } } };
    expect(driftOf(stringify(written), live)).toBeUndefined();
    expect(driftOf(stringify(written), { ...live, spec: { ...live.spec, configs: { 'retention.ms': '1' } } })).toBe(
      'changed',
    );
  });
});
