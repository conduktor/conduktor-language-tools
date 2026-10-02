import { stringify } from 'yaml';
import type { KindVersion } from '../openapi/kindCatalog';
import { isRecord } from '../util';
import type { Resource } from './types';

const IDENTITY_KEYS = ['apiVersion', 'kind', 'metadata', 'spec'];

export function newResourceYaml(kind: KindVersion, parents: Readonly<Record<string, string>>): string {
  const example = isRecord(kind.applyExample) ? kind.applyExample : {};
  const metadata = isRecord(example.metadata) ? example.metadata : { name: `my-${kebabCase(kind.kind)}` };
  return stringify({
    ...example,
    apiVersion: `v${kind.version}`,
    kind: kind.kind,
    metadata: { ...metadata, ...parents },
    spec: example.spec ?? {},
  });
}

export function comparableYaml(resource: Resource): string {
  const identityFirst = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);
  return stringify(sortKeys(resource, identityFirst));
}

function rank(key: string): number {
  const index = IDENTITY_KEYS.indexOf(key);
  return index === -1 ? IDENTITY_KEYS.length : index;
}

function sortKeys(value: unknown, compare: (a: string, b: string) => number): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item, byName));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compare)
      .map((key) => [key, sortKeys(value[key], byName)]),
  );
}

function byName(a: string, b: string): number {
  return a.localeCompare(b);
}

function kebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
