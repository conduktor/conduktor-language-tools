import { parse } from 'yaml';
import type { Resource } from '../resources/types';
import { comparableYaml } from '../resources/yamlText';
import { redactSecrets } from '../tools/redact';
import { isRecord, valueAtPath } from '../util';

export type SyncStatus = 'new' | 'modified' | 'synced';
export type Drift = 'changed' | 'deleted';

export function syncStatus(local: string, base: string | undefined): SyncStatus {
  if (base === undefined) return 'new';
  return normalised(local) === normalised(base) ? 'synced' : 'modified';
}

// What the Console fills in itself, so a resource applied from a file never holds it: fields only the published GET
// responses carry, and the reference docs' read-only fields.
const SERVER_MANAGED: Readonly<Record<string, readonly string[]>> = {
  Subject: ['spec.id', 'spec.version', 'spec.guid'],
  User: ['metadata.lastLoginDate'],
  Application: ['spec.createdAt'],
  Alert: ['metadata.updatedAt', 'metadata.updatedBy', 'metadata.lastTriggeredAt', 'metadata.status', 'spec.promQl'],
  PartnerZone: ['metadata.id', 'metadata.updatedAt', 'metadata.status', 'metadata.failedReason'],
  DataQualityRule: [
    'metadata.createdAt',
    'metadata.updatedAt',
    'metadata.createdBy',
    'metadata.updatedBy',
    'metadata.attachedPolicies',
    'metadata.builtIn',
  ],
  DataQualityPolicy: [
    'metadata.nameForMetrics',
    'metadata.createdAt',
    'metadata.updatedAt',
    'metadata.createdBy',
    'metadata.updatedBy',
    'metadata.status',
    'metadata.statuses',
    'metadata.statusInfo',
    'metadata.metrics',
    'metadata.attachedRules',
  ],
};

// The Console labels what an application owns; a copy sent by the user is dropped, so these are never the user's.
const OWNERSHIP_LABEL = 'conduktor.io/application';
const OWNED_KINDS = new Set(['Topic', 'Subject', 'Connector']);

// Filled in by the Console only when the file leaves them out.
const DEFAULTED: Readonly<Record<string, readonly string[]>> = { Topic: ['spec.replicationFactor'] };

// Secrets are compared redacted: the base holds ${VAR} placeholders where the Console holds the values. What the
// Console manages or fills in itself is left out on both sides, and both are read the way the Console returns them.
export function driftOf(base: string, live: Resource | undefined): Drift | undefined {
  if (live === undefined) return 'deleted';
  const written = parsedResource(base);
  if (!written) return base === comparable(live, live) ? undefined : 'changed';
  return comparable(written, written) === comparable(live, written) ? undefined : 'changed';
}

function normalised(text: string): string {
  const resource = parsedResource(text);
  return resource ? comparableYaml(resource) : text;
}

export function parsedResource(text: string): Resource | undefined {
  let value: unknown;
  try {
    value = parse(text);
  } catch {
    return undefined;
  }
  return isRecord(value) ? (value as Resource) : undefined;
}

function comparable(resource: Resource, written: Resource): string {
  const leftOut = [
    ...(SERVER_MANAGED[resource.kind] ?? []),
    ...(DEFAULTED[resource.kind] ?? []).filter((path) => valueAtPath(written, path.split('.')) === undefined),
  ];
  const kept = leftOut.reduce((node, path) => without(node, path.split('.')), redactSecrets(resource).value);
  const copy = structuredClone(kept) as Resource;
  const labels = copy.metadata.labels;
  if (isRecord(labels)) {
    const userLabels = OWNED_KINDS.has(copy.kind)
      ? Object.fromEntries(Object.entries(labels).filter(([key]) => !key.startsWith(OWNERSHIP_LABEL)))
      : labels;
    // The Console leaves out labels it holds none of.
    if (Object.keys(userLabels).length === 0) delete copy.metadata.labels;
    else copy.metadata.labels = userLabels;
  }
  // Topic configs come back as strings, whatever the file wrote.
  const spec = copy.spec;
  if (copy.kind === 'Topic' && isRecord(spec) && isRecord(spec.configs))
    spec.configs = Object.fromEntries(Object.entries(spec.configs).map(([key, value]) => [key, String(value)]));
  return comparableYaml(copy);
}

// The node without the field at the end of `path`: the objects on the way are copies, everything else is shared.
function without(node: unknown, [key, ...rest]: readonly string[]): unknown {
  if (key === undefined || !isRecord(node)) return node;
  return Object.fromEntries(
    Object.entries(node).flatMap(([name, value]) =>
      name !== key ? [[name, value]] : rest.length > 0 ? [[name, without(value, rest)]] : [],
    ),
  );
}
