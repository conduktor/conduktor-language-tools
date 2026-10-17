import { describe, expect, it } from 'vitest';
import { hasBody } from '../src/openapi/kindCatalog';
import { kindSchema } from '../src/openapi/kindSchema';
import { findReferences, referenceAt } from '../src/references/extract';
import { REFERENCE_RULES } from '../src/references/table';
import { snapshotCatalog, snapshotSchema } from './fixtures';

interface Node {
  $ref?: string;
  oneOf?: Node[];
  anyOf?: Node[];
  allOf?: Node[];
  items?: Node;
  properties?: Record<string, Node>;
  definitions?: Record<string, Node>;
}

function schemaHas(root: Node, path: string): boolean {
  const defs = root.definitions ?? {};
  const segments = path.replace(/\[\]/g, '.[]').split('.');
  const step = (node: Node | undefined, i: number): boolean => {
    if (!node) return false;
    if (node.$ref) return step(defs[node.$ref.split('/').pop()!], i);
    for (const variants of [node.oneOf, node.anyOf, node.allOf]) if (variants?.some((n) => step(n, i))) return true;
    if (i === segments.length) return true;
    return segments[i] === '[]' ? step(node.items, i + 1) : step(node.properties?.[segments[i]!], i + 1);
  };
  return step(root, 0);
}

describe('the reference table', () => {
  it("names only fields that exist in each kind's schema", () => {
    const missing = REFERENCE_RULES.filter((rule) => {
      const kind = snapshotCatalog.latest(rule.kind);
      if (!hasBody(kind)) return true;
      const root = kindSchema(snapshotSchema, kind) as Node;
      const item = rule.path.slice(0, rule.path.lastIndexOf('.'));
      const siblings = [rule.cluster, rule.connectCluster, rule.pattern && '.patternType']
        .filter((p): p is string => typeof p === 'string' && p.startsWith('.'))
        .map((p) => item + p);
      const by = typeof rule.target === 'object' ? [`${item}.${rule.target.by}`] : [];
      return ![rule.path, ...siblings, ...by].every((p) => schemaHas(root, p));
    });
    expect(missing.map((r) => `${r.kind} ${r.path}`)).toEqual([]);
  });
});

describe('findReferences', () => {
  const instance = {
    apiVersion: 'v1',
    kind: 'ApplicationInstance',
    metadata: { name: 'shop-dev', application: 'shop' },
    spec: {
      cluster: 'local',
      topicPolicyRef: ['naming'],
      resources: [
        { type: 'TOPIC', name: 'shop.', patternType: 'PREFIXED' },
        { type: 'CONNECTOR', name: 'shop-sink', patternType: 'LITERAL', connectCluster: 'main' },
        { type: 'CONSUMER_GROUP', name: 'shop.', patternType: 'PREFIXED' },
      ],
    },
  };

  it('finds each reference with its target kind, scope and pattern', () => {
    expect(
      findReferences(instance, snapshotCatalog).map((r) => [
        r.path.join('.'),
        r.kind,
        r.value,
        r.parents,
        r.pattern?.type,
      ]),
    ).toEqual([
      ['metadata.application', 'Application', 'shop', [], undefined],
      ['spec.cluster', 'KafkaCluster', 'local', [], undefined],
      ['spec.topicPolicyRef.0', 'TopicPolicy', 'naming', [], undefined],
      ['spec.resources.0.name', 'Topic', 'shop.', ['local'], 'PREFIXED'],
      ['spec.resources.1.name', 'Connector', 'shop-sink', ['local', 'main'], 'LITERAL'],
      ['spec.resources.1.connectCluster', 'KafkaConnectCluster', 'main', ['local'], undefined],
    ]);
  });

  it('has no scope when the cluster is missing or *, so nothing is reported missing', () => {
    const group = {
      apiVersion: 'v2',
      kind: 'Group',
      metadata: { name: 'team' },
      spec: {
        members: ['a@b.io'],
        permissions: [
          {
            resourceType: 'TOPIC',
            cluster: '*',
            name: 'orders',
            patternType: 'LITERAL',
            permissions: ['topicConsume'],
          },
          { resourceType: 'CLUSTER', name: 'local', permissions: ['clusterViewBroker'] },
        ],
      },
    };
    const refs = findReferences(group, snapshotCatalog);
    const at = (path: string) => refs.find((r) => r.path.join('.') === path);
    expect(at('spec.permissions.0.name')).toMatchObject({ kind: 'Topic', parents: undefined });
    expect(at('spec.permissions.0.cluster')).toMatchObject({ wildcard: true });
    expect(at('spec.permissions.1.name')).toMatchObject({ kind: 'KafkaCluster', parents: [] });
    expect(at('spec.members.0')).toMatchObject({ kind: 'User', value: 'a@b.io' });
  });

  it('reads service-account ACLs the Kafka way and skips types with no IaC list', () => {
    const account = {
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: { name: 'sa', cluster: 'local' },
      spec: {
        authorization: {
          type: 'KAFKA_ACL',
          acls: [
            { type: 'TOPIC', name: '*', patternType: 'LITERAL', operations: ['Read'] },
            { type: 'CONSUMER_GROUP', name: 'g', patternType: 'LITERAL', operations: ['Read'] },
          ],
        },
      },
    };
    const acl = findReferences(account, snapshotCatalog).filter((r) => r.path[0] === 'spec');
    expect(acl.map((r) => [r.kind, r.pattern?.reading, r.wildcard])).toEqual([['Topic', 'kafkaAcl', true]]);
  });
});

describe('referenceAt', () => {
  it('knows what an empty value refers to, for completion', () => {
    const app = { apiVersion: 'v1', kind: 'Application', metadata: { name: 'shop' }, spec: { owner: null } };
    expect(referenceAt(app, snapshotCatalog, ['spec', 'owner'])).toMatchObject({
      kind: 'Group',
      value: '',
      parents: [],
    });
    expect(referenceAt(app, snapshotCatalog, ['spec', 'title'])).toBeUndefined();
  });
});
