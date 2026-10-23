import type { PatternReading } from './patterns';

export interface ReferenceRule {
  kind: string;
  path: string;
  target: string | { by: string; kinds: Readonly<Record<string, string>> };
  pattern?: PatternReading;
  cluster?: string;
  connectCluster?: string;
  wildcard?: boolean;
}

const SELF_SERVE_KINDS = { TOPIC: 'Topic', SUBJECT: 'Subject', CONNECTOR: 'Connector' };
const PERMISSION_KINDS = { CLUSTER: 'KafkaCluster', TOPIC: 'Topic', SUBJECT: 'Subject', KAFKA_CONNECT: 'Connector' };
const clusterOf = (kind: string): ReferenceRule => ({ kind, path: 'metadata.cluster', target: 'KafkaCluster' });
const permissions = (kind: string): ReferenceRule[] => [
  { kind, path: 'spec.permissions[].cluster', target: 'KafkaCluster', wildcard: true },
  { kind, path: 'spec.permissions[].kafkaConnect', target: 'KafkaConnectCluster', cluster: '.cluster', wildcard: true },
  {
    kind,
    path: 'spec.permissions[].name',
    target: { by: 'resourceType', kinds: PERMISSION_KINDS },
    pattern: 'rbac',
    cluster: '.cluster',
    connectCluster: '.kafkaConnect',
    wildcard: true,
  },
];

// What each field names, as the Console resolves it. Consumer groups, Kafka principals and transactional ids have no IaC list,
// so their references are left out.
export const REFERENCE_RULES: readonly ReferenceRule[] = [
  { kind: 'Application', path: 'spec.owner', target: 'Group' },
  { kind: 'Application', path: 'spec.policyRef[]', target: 'ResourcePolicy' },
  { kind: 'ApplicationInstance', path: 'metadata.application', target: 'Application' },
  { kind: 'ApplicationInstance', path: 'spec.cluster', target: 'KafkaCluster' },
  { kind: 'ApplicationInstance', path: 'spec.topicPolicyRef[]', target: 'TopicPolicy' },
  { kind: 'ApplicationInstance', path: 'spec.policyRef[]', target: 'ResourcePolicy' },
  {
    kind: 'ApplicationInstance',
    path: 'spec.resources[].name',
    target: { by: 'type', kinds: SELF_SERVE_KINDS },
    pattern: 'selfServe',
    cluster: 'spec.cluster',
    connectCluster: '.connectCluster',
  },
  {
    kind: 'ApplicationInstance',
    path: 'spec.resources[].connectCluster',
    target: 'KafkaConnectCluster',
    cluster: 'spec.cluster',
  },
  { kind: 'ApplicationInstancePermission', path: 'metadata.application', target: 'Application' },
  { kind: 'ApplicationInstancePermission', path: 'metadata.appInstance', target: 'ApplicationInstance' },
  { kind: 'ApplicationInstancePermission', path: 'spec.grantedTo', target: 'ApplicationInstance' },
  { kind: 'ApplicationGroup', path: 'metadata.application', target: 'Application' },
  { kind: 'ApplicationGroup', path: 'spec.permissions[].appInstance', target: 'ApplicationInstance' },
  { kind: 'ApplicationGroup', path: 'spec.members[]', target: 'User' },
  clusterOf('ServiceAccount'),
  { kind: 'ServiceAccount', path: 'metadata.appInstance', target: 'ApplicationInstance' },
  {
    kind: 'ServiceAccount',
    path: 'spec.authorization.acls[].name',
    target: { by: 'type', kinds: { TOPIC: 'Topic' } },
    pattern: 'kafkaAcl',
    cluster: 'metadata.cluster',
    wildcard: true,
  },
  { kind: 'Group', path: 'spec.members[]', target: 'User' },
  ...permissions('Group'),
  ...permissions('User'),
  clusterOf('Topic'),
  clusterOf('Subject'),
  clusterOf('KafkaConnectCluster'),
  clusterOf('KsqlDBCluster'),
  clusterOf('IndexedTopic'),
  { kind: 'Connector', path: 'metadata.connectCluster', target: 'KafkaConnectCluster', cluster: 'metadata.cluster' },
  { kind: 'Subject', path: 'spec.references[].subject', target: 'Subject', cluster: 'metadata.cluster' },
  { kind: 'IndexedTopic', path: 'metadata.name', target: 'Topic', cluster: 'metadata.cluster' },
  { kind: 'KafkaCluster', path: 'spec.policiesRef[]', target: 'ResourcePolicy' },
  { kind: 'KafkaConnectCluster', path: 'spec.policiesRef[]', target: 'ResourcePolicy' },
  { kind: 'DataQualityPolicy', path: 'metadata.group', target: 'Group' },
  { kind: 'DataQualityPolicy', path: 'spec.rules[]', target: 'DataQualityRule' },
  { kind: 'DataQualityPolicy', path: 'spec.targets[].cluster', target: 'KafkaCluster' },
  {
    kind: 'DataQualityPolicy',
    path: 'spec.targets[].topic',
    target: 'Topic',
    pattern: 'dataQuality',
    cluster: '.cluster',
  },
];
