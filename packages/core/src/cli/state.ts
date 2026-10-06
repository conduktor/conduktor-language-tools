import type { KindCatalog } from '../openapi/kindCatalog';
import { isRecord } from '../util';
import type { CliOutcome } from './output';

export interface StateResource {
  kind: string;
  parents: string[];
  name: string;
}

/**
 * What an apply deleted: resources in ctl's state before it and not after, by kind, parents and name. A resource ctl
 * dropped and added back (it tells them apart by all their metadata) is still there, so it is not counted.
 */
export function leftState(
  before: string | undefined,
  after: string | undefined,
  catalog: KindCatalog,
): StateResource[] {
  const kept = new Set(resourcesOf(after, catalog).map((r) => JSON.stringify(r)));
  return resourcesOf(before, catalog).filter((r) => !kept.has(JSON.stringify(r)));
}

/** A plan's deletes, and those of them the same run applies again: ctl deletes those first, losing their data. */
export function planWarnings(outcomes: readonly CliOutcome[]): { deleted: string[]; recreated: string[] } {
  const label = (o: CliOutcome) => `${o.kind}/${o.name}`;
  const deleted = outcomes.filter((o) => o.result === 'Deleted').map(label);
  const applied = new Set(outcomes.filter((o) => o.result !== 'Deleted' && o.result !== 'failed').map(label));
  return { deleted, recreated: deleted.filter((name) => applied.has(name)) };
}

function resourcesOf(text: string | undefined, catalog: KindCatalog): StateResource[] {
  let value: unknown;
  try {
    value = text === undefined ? undefined : JSON.parse(text);
  } catch {
    return [];
  }
  const resources = isRecord(value) && Array.isArray(value.resources) ? value.resources : [];
  return resources.flatMap((resource: unknown) => {
    if (!isRecord(resource) || typeof resource.kind !== 'string' || !isRecord(resource.metadata)) return [];
    const { metadata } = resource;
    const kind =
      typeof resource.apiVersion === 'string' ? catalog.resolve(resource.apiVersion, resource.kind) : undefined;
    if (typeof metadata.name !== 'string') return [];
    const params = kind?.parentPathParams ?? [];
    const parents = params.map((param) => (typeof metadata[param] === 'string' ? (metadata[param] as string) : ''));
    return [{ kind: resource.kind, parents, name: metadata.name }];
  });
}
