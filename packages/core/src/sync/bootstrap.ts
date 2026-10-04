import type { ConsoleClient } from '../client/consoleClient';
import { ConsoleError, describeError } from '../client/errors';
import type { KindCatalog, KindVersion } from '../openapi/kindCatalog';
import { PARENT_KINDS } from '../openapi/parents';
import { listPath, parentsOf } from '../openapi/paths';
import type { Resource } from '../resources/types';

export interface Fetched {
  kind: KindVersion;
  parents: string[];
  resource: Resource;
}

export interface Skipped {
  kind: string;
  parents: string[];
  name?: string;
  reason: string;
}

export interface CollectOptions {
  concurrency?: number;
  cancelled?: () => boolean;
  onProgress?: (done: number, total: number) => void;
}

export interface BootstrapResult {
  written: Record<string, number>;
  unchanged: number;
  conflicts: string[];
  skipped: Skipped[];
  cancelled: boolean;
}

const BUILT_IN = 'Built in, managed by the Console';

export async function collectResources(
  client: Pick<ConsoleClient, 'list'>,
  catalog: KindCatalog,
  kinds: readonly string[],
  options: CollectOptions = {},
): Promise<{ fetched: Fetched[]; skipped: Skipped[]; cancelled: boolean }> {
  const cancelled = options.cancelled ?? (() => false);
  const skipped: Skipped[] = [];
  // Parents (clusters, Connect clusters) are listed once, whether as a parent or as a kind of their own.
  const lists = new Map<string, Promise<Resource[]>>();
  const list = (path: string) => {
    const resources = lists.get(path) ?? client.list(path);
    lists.set(path, resources);
    return resources;
  };

  const chains = async (kind: KindVersion, prefix: string[]): Promise<string[][]> => {
    if (prefix.length === kind.parentPathParams.length) return [prefix];
    const param = kind.parentPathParams[prefix.length]!;
    const parentKind = PARENT_KINDS[param] ? catalog.latest(PARENT_KINDS[param]) : undefined;
    if (!parentKind) {
      skipped.push({ kind: kind.kind, parents: prefix, reason: `Listing by ${param} is not supported` });
      return [];
    }
    let names: string[];
    try {
      names = (await list(listPath(parentKind, parentsOf(kind, prefix)))).map((r) => r.metadata.name);
    } catch (error) {
      skipped.push({ kind: kind.kind, parents: prefix, reason: reasonOf(error) });
      return [];
    }
    return (await Promise.all(names.map((name) => chains(kind, [...prefix, name])))).flat();
  };

  const targets: { kind: KindVersion; parents: string[] }[] = [];
  for (const name of kinds) {
    const kind = catalog.latest(name);
    if (!kind) {
      skipped.push({ kind: name, parents: [], reason: 'Not on this Console' });
      continue;
    }
    for (const parents of await chains(kind, [])) targets.push({ kind, parents });
  }

  const fetched: Fetched[] = [];
  let done = 0;
  let stopped = false;
  await eachLimit(targets, options.concurrency ?? 4, async ({ kind, parents }) => {
    if (cancelled()) {
      stopped = true;
      return;
    }
    try {
      for (const resource of await list(listPath(kind, parentsOf(kind, parents)))) {
        if (resource.metadata.builtIn === true)
          skipped.push({ kind: kind.kind, parents, name: resource.metadata.name, reason: BUILT_IN });
        else fetched.push({ kind, parents, resource });
      }
    } catch (error) {
      skipped.push({ kind: kind.kind, parents, reason: reasonOf(error) });
    }
    options.onProgress?.(++done, targets.length);
  });

  const key = (f: Fetched) => [...f.parents, f.resource.metadata.name].join('\0');
  fetched.sort(
    (a, b) =>
      catalog.orderOf(a.kind.kind) - catalog.orderOf(b.kind.kind) ||
      a.kind.kind.localeCompare(b.kind.kind) ||
      key(a).localeCompare(key(b)),
  );
  return { fetched, skipped, cancelled: stopped };
}

export function describeBootstrap(
  environment: string,
  result: BootstrapResult,
): { headline: string; details: string[] } {
  const written = Object.values(result.written).reduce((sum, n) => sum + n, 0);
  const parts = [
    `${written} written`,
    `${result.unchanged} unchanged`,
    result.conflicts.length > 0 && `${result.conflicts.length} left alone`,
    result.skipped.length > 0 && `${result.skipped.length} skipped`,
  ].filter(Boolean);
  const headline = `${environment}: ${parts.join(', ')}${result.cancelled ? ' — cancelled before the end' : ''}.`;
  const details = [
    written > 0 &&
      `Written: ${Object.entries(result.written)
        .map(([kind, n]) => `${kind} ${n}`)
        .join(', ')}`,
    result.conflicts.length > 0 && `Left alone (local changes or not a synced copy): ${result.conflicts.join(', ')}`,
    ...result.skipped.map(
      (s) =>
        `Skipped ${s.kind}${s.name ? ` ${s.name}` : ''}${s.parents.length > 0 ? ` in ${s.parents.join(' / ')}` : ''}: ${s.reason}`,
    ),
  ].filter((line): line is string => typeof line === 'string');
  return { headline, details };
}

function reasonOf(error: unknown): string {
  return error instanceof ConsoleError && error.status === 403 ? 'No access' : describeError(error);
}

export async function eachLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
