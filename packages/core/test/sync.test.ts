import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { referencedVariables } from '../src/resources/envVars';
import type { Resource } from '../src/resources/types';
import { syncPath } from '../src/sync/paths';
import { withSecretPlaceholders } from '../src/sync/placeholders';
import { isDrifted, syncStatus } from '../src/sync/status';
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

describe('isDrifted', () => {
  const cluster: Resource = {
    apiVersion: 'v2',
    kind: 'KafkaCluster',
    metadata: { name: 'prod' },
    spec: { bootstrapServers: 'k:9092', kafkaFlavor: { type: 'Gateway', url: 'u', user: 'a', password: 'real' } },
  };
  const { resource: synced } = withSecretPlaceholders(cluster);

  it('is false while the Console still matches the base, secrets aside', () => {
    expect(isDrifted(stringify(synced), cluster)).toBe(false);
  });

  it('is true when the Console changed or the resource is gone', () => {
    expect(
      isDrifted(stringify(synced), { ...cluster, spec: { ...(cluster.spec as object), bootstrapServers: 'k:9093' } }),
    ).toBe(true);
    expect(isDrifted(stringify(synced), undefined)).toBe(true);
  });
});

describe('withSecretPlaceholders', () => {
  it('replaces secret values with environment variables named after the resource and field', () => {
    const { resource, variables } = withSecretPlaceholders({
      apiVersion: 'v2',
      kind: 'KafkaCluster',
      metadata: { name: 'local-gateway' },
      spec: {
        bootstrapServers: 'k:9092',
        properties: { 'sasl.jaas.config': 'secret jaas', 'security.protocol': 'SASL_SSL' },
        kafkaFlavor: { type: 'Gateway', user: 'admin', password: 'conduktor' },
      },
    });
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
    expect(withSecretPlaceholders(topic)).toEqual({ resource: topic, variables: [] });
  });
});

describe('referencedVariables', () => {
  it('lists the variables a file needs, once each, ignoring escaped ones', () => {
    expect(referencedVariables('a: ${A}\nb: ${B:-x}\nc: $${C}\nd: ${A}\n')).toEqual(['A', 'B']);
  });
});
