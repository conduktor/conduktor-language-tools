import { parse } from 'yaml';
import type { Resource } from '../resources/types';
import { comparableYaml } from '../resources/yamlText';
import { redactSecrets } from '../tools/redact';
import { isRecord } from '../util';

export type SyncStatus = 'new' | 'modified' | 'synced';
export type Drift = 'changed' | 'deleted';

export function syncStatus(local: string, base: string | undefined): SyncStatus {
  if (base === undefined) return 'new';
  return normalised(local, comparableYaml) === normalised(base, comparableYaml) ? 'synced' : 'modified';
}

// What the Console fills in itself, so a resource applied from a file never holds it. From the published schema (fields
// only its responses carry), the reference docs' read-only fields, and what a local Console returns.
const SERVER_MANAGED: Readonly<Record<string, readonly string[]>> = {
  Subject: ['spec.id', 'spec.version', 'spec.guid'],
  User: ['metadata.lastLoginDate'],
  Application: ['spec.createdAt'],
  Alert: ['metadata.updatedAt', 'metadata.updatedBy', 'metadata.lastTriggeredAt', 'metadata.status', 'spec.promQl'],
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
    'metadata.group',
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

// Secrets are compared redacted: the base holds ${VAR} placeholders where the Console holds the values. Fields the
// Console manages itself are left out on both sides.
export function driftOf(base: string, live: Resource | undefined): Drift | undefined {
  if (live === undefined) return 'deleted';
  return normalised(base, redactedYaml) === redactedYaml(live) ? undefined : 'changed';
}

function normalised(text: string, toText: (resource: Resource) => string): string {
  let value: unknown;
  try {
    value = parse(text);
  } catch {
    return text;
  }
  return isRecord(value) ? toText(value as Resource) : text;
}

function redactedYaml(resource: Resource): string {
  return comparableYaml(withoutServerManaged(redactSecrets(resource).value as Resource));
}

function withoutServerManaged(resource: Resource): Resource {
  const paths = SERVER_MANAGED[resource.kind] ?? [];
  if (paths.length === 0) return resource;
  const copy = structuredClone(resource) as Record<string, unknown>;
  for (const path of paths) {
    const segments = path.split('.');
    const parent = segments.slice(0, -1).reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), copy);
    if (isRecord(parent)) delete parent[segments.at(-1)!];
  }
  return copy as Resource;
}
