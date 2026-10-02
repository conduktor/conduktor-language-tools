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

// Secrets are compared redacted: the base holds ${VAR} placeholders where the Console holds the values.
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
  return comparableYaml(redactSecrets(resource).value as Resource);
}
