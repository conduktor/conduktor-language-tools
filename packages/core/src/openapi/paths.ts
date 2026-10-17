import type { Resource } from '../resources/types';
import type { KindVersion } from './kindCatalog';

export class MissingParentError extends Error {
  override name = 'MissingParentError';
}

export interface Target {
  path: string;
  query: Record<string, string>;
}

export function listPath(kind: KindVersion, parents: Readonly<Record<string, string>>): string {
  return kind.listPath.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = parents[name];
    if (value === undefined || value === '') {
      throw new MissingParentError(`metadata.${name} is required for ${kind.kind}`);
    }
    return encodeURIComponent(value);
  });
}

export function itemPath(kind: KindVersion, parents: Readonly<Record<string, string>>, name: string): string {
  return `${listPath(kind, parents)}/${encodeURIComponent(name)}`;
}

export function parentsOf(kind: KindVersion, values: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    kind.parentPathParams.flatMap((param, i) => {
      const value = values[i];
      return value === undefined ? [] : [[param, value]];
    }),
  );
}

export function upsertTarget(kind: KindVersion, resource: Resource): Target {
  return {
    path: listPath(kind, pick(resource, kind.parentPathParams)),
    query: pick(resource, kind.parentQueryParams),
  };
}

export function resourcePath(kind: KindVersion, resource: Resource): string {
  return itemPath(kind, pick(resource, kind.parentPathParams), resource.metadata.name);
}

function pick(resource: Resource, names: readonly string[]): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = resource.metadata[name];
    if (typeof value === 'string') picked[name] = value;
  }
  return picked;
}
