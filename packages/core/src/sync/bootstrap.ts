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
  reason: string;
}

/**
 * Where a Sync Everything is. Listing takes most of the time: one slow list (a cluster the Console waits a minute on)
 * holds up the end, so the lists still out are named.
 */
export type BootstrapStage =
  | { stage: 'finding' }
  | { stage: 'listing'; done: number; total: number; resources: number; waiting: string[] }
  | { stage: 'writing'; done: number; total: number }
  | { stage: 'indexing' }
  | { stage: 'envExample' };

export interface CollectOptions {
  concurrency?: number;
  cancelled?: () => boolean;
  onProgress?: (stage: BootstrapStage) => void;
}

export interface BootstrapResult {
  written: Record<string, number>;
  unchanged: number;
  conflicts: string[];
  skipped: Skipped[];
  builtIn: string[];
  cancelled: boolean;
}

const count = (n: number) => n.toLocaleString('en');
const share = (from: number, width: number, done: number, total: number) =>
  Math.round((from + (total > 0 ? (width * done) / total : 0)) * 100) / 100;

/** The notification's message and percentage; `waitedMs` is how long since the last list came back. */
export function bootstrapProgress(stage: BootstrapStage, waitedMs = 0): { message: string; percent: number } {
  switch (stage.stage) {
    case 'finding':
      return { message: 'Finding clusters and Connect clusters…', percent: 0 };
    case 'listing': {
      const { waiting } = stage;
      const names =
        waiting.length > 3 ? `${waiting.slice(0, 2).join(', ')} and ${waiting.length - 2} more` : waiting.join(', ');
      const waited = waitedMs >= 1000 ? `, ${Math.floor(waitedMs / 1000)} s` : '';
      return {
        message: `Listing ${stage.done} of ${stage.total} (${count(stage.resources)} resources)${
          waiting.length > 0 ? `, waiting on ${names}${waited}` : ''
        }`,
        percent: share(0, 90, stage.done, stage.total),
      };
    }
    case 'writing':
      return {
        message: `Writing files: ${count(stage.done)} of ${count(stage.total)}`,
        percent: share(90, 8, stage.done, stage.total),
      };
    case 'indexing':
      return { message: 'Indexing the folder…', percent: 98 };
    case 'envExample':
      return { message: 'Writing .env.example…', percent: 99 };
  }
}

export async function collectResources(
  client: Pick<ConsoleClient, 'list'>,
  catalog: KindCatalog,
  kinds: readonly string[],
  options: CollectOptions = {},
): Promise<{ fetched: Fetched[]; skipped: Skipped[]; builtIn: string[]; cancelled: boolean }> {
  const cancelled = options.cancelled ?? (() => false);
  const limit = limiter(options.concurrency ?? 4);
  const skipped: Skipped[] = [];
  let stopped = false;
  // Parents (clusters, Connect clusters) are listed once, whether as a parent or as a kind of their own.
  const lists = new Map<string, Promise<Resource[]>>();
  const list = (path: string) => {
    const resources =
      lists.get(path) ??
      limit(async () => {
        if (cancelled()) {
          stopped = true;
          return [];
        }
        return client.list(path);
      });
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

  options.onProgress?.({ stage: 'finding' });
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
  const builtIn: string[] = [];
  let done = 0;
  const label = ({ kind, parents }: (typeof targets)[number]) =>
    parents.length > 0 ? `${kind.kind} in ${parents.join(' / ')}` : kind.kind;
  const out = new Set(targets);
  await Promise.all(
    targets.map(async (target) => {
      const { kind, parents } = target;
      try {
        for (const resource of await list(listPath(kind, parentsOf(kind, parents)))) {
          if (resource.metadata.builtIn === true) builtIn.push(`${kind.kind} ${resource.metadata.name}`);
          else fetched.push({ kind, parents, resource });
        }
      } catch (error) {
        skipped.push({ kind: kind.kind, parents, reason: reasonOf(error) });
      }
      out.delete(target);
      options.onProgress?.({
        stage: 'listing',
        done: ++done,
        total: targets.length,
        resources: fetched.length,
        waiting: [...out].map(label),
      });
    }),
  );

  const key = (f: Fetched) => [...f.parents, f.resource.metadata.name].join('\0');
  fetched.sort(
    (a, b) =>
      catalog.orderOf(a.kind.kind) - catalog.orderOf(b.kind.kind) ||
      a.kind.kind.localeCompare(b.kind.kind) ||
      key(a).localeCompare(key(b)),
  );
  return { fetched, skipped, builtIn: builtIn.sort(), cancelled: stopped };
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
    result.builtIn.length > 0 && `${result.builtIn.length} built in left out`,
  ].filter(Boolean);
  const headline = `${environment}: ${parts.join(', ')}${result.cancelled ? ' — cancelled before the end' : ''}.`;
  const details = [
    written > 0 &&
      `Written: ${Object.entries(result.written)
        .map(([kind, n]) => `${kind} ${n}`)
        .join(', ')}`,
    result.conflicts.length > 0 && `Left alone (local changes or not a synced copy): ${result.conflicts.join(', ')}`,
    ...result.skipped.map(
      (s) => `Skipped ${s.kind}${s.parents.length > 0 ? ` in ${s.parents.join(' / ')}` : ''}: ${s.reason}`,
    ),
    result.builtIn.length > 0 && `Left out, built in and managed by the Console: ${result.builtIn.join(', ')}`,
  ].filter((line): line is string => typeof line === 'string');
  return { headline, details };
}

function reasonOf(error: unknown): string {
  return error instanceof ConsoleError && error.status === 403 ? 'No access' : describeError(error);
}

function limiter(slots: number): <T>(run: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (run) => {
    while (active >= slots) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await run();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

export async function eachLimit<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
