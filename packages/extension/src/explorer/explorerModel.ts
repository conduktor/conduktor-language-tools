import {
  ConsoleError,
  describeError,
  listPath,
  parentsOf,
  PARENT_KINDS,
  type ConsoleClient,
  type KindCatalog,
  type KindVersion,
  type SyncStatus,
} from '@conduktor/vscode-core';

export interface LocalMark {
  status: SyncStatus;
  drifted: boolean;
  uri: string;
}

export interface LocalResource {
  kind: string;
  parents: string[];
  name: string;
  mark: LocalMark;
}

export type ExplorerNode =
  | { type: 'group'; group: string }
  | { type: 'kind'; kind: KindVersion }
  | { type: 'parent'; kind: KindVersion; parents: string[] }
  | { type: 'resource'; kind: KindVersion; parents: string[]; name: string; local?: LocalMark }
  | { type: 'message'; text: string; detail?: string; noAccess?: boolean };

export type ResourceNode = Extract<ExplorerNode, { type: 'resource' }>;

export interface ExplorerSource {
  catalog: KindCatalog;
  client: Pick<ConsoleClient, 'list'>;
  local?: readonly LocalResource[];
  onlyChanges?: boolean;
}

export async function childrenOf(source: ExplorerSource, node?: ExplorerNode): Promise<ExplorerNode[]> {
  const kinds = visibleKinds(source);
  if (!node) return [...new Set(kinds.map((k) => k.group))].sort().map((group) => ({ type: 'group', group }));
  switch (node.type) {
    case 'group':
      return kinds.filter((kind) => kind.group === node.group).map((kind) => ({ type: 'kind', kind }));
    case 'kind':
      return nextLevel(source, node.kind, []);
    case 'parent':
      return nextLevel(source, node.kind, node.parents);
    default:
      return [];
  }
}

function visibleKinds(source: ExplorerSource): KindVersion[] {
  const changed = source.onlyChanges ? new Set(changes(source).map((r) => r.kind)) : undefined;
  return [...source.catalog.kindNames()]
    .filter((name) => !changed || changed.has(name))
    .map((name) => source.catalog.latest(name)!)
    .sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind));
}

async function nextLevel(source: ExplorerSource, kind: KindVersion, parents: string[]): Promise<ExplorerNode[]> {
  const locals = (source.onlyChanges ? changes(source) : (source.local ?? [])).filter(
    (r) => r.kind === kind.kind && parents.every((parent, i) => r.parents[i] === parent),
  );
  const param = kind.parentPathParams[parents.length];
  if (param !== undefined) {
    const parentKindName = PARENT_KINDS[param];
    const parentKind = parentKindName ? source.catalog.latest(parentKindName) : undefined;
    if (!parentKind) return [{ type: 'message', text: `Browsing by ${param} is not supported` }];
    const localNames = locals.map((r) => r.parents[parents.length]!).filter(Boolean);
    return withLive(source, listPath(parentKind, parentsOf(kind, parents)), localNames, (name) => ({
      type: 'parent',
      kind,
      parents: [...parents, name],
    }));
  }
  const marks = new Map(locals.map((r) => [r.name, r.mark]));
  return withLive(source, listPath(kind, parentsOf(kind, parents)), [...marks.keys()], (name) => {
    const mark = marks.get(name);
    return { type: 'resource', kind, parents, name, ...(mark && { local: mark }) };
  });
}

// Live names and local names merge into one sorted list; local work stays visible when the Console cannot be listed.
async function withLive(
  source: ExplorerSource,
  path: string,
  localNames: readonly string[],
  toNode: (name: string) => ExplorerNode,
): Promise<ExplorerNode[]> {
  let liveNames: string[] = [];
  let problem: ExplorerNode | undefined;
  if (!source.onlyChanges) {
    try {
      liveNames = (await source.client.list(path)).map((r) => r.metadata.name);
    } catch (error) {
      problem =
        error instanceof ConsoleError && error.status === 403
          ? { type: 'message', text: 'No access', detail: error.message, noAccess: true }
          : { type: 'message', text: 'Failed to load', detail: describeError(error) };
    }
  }
  const nodes = [...new Set([...liveNames, ...localNames])].sort((a, b) => a.localeCompare(b)).map(toNode);
  if (problem) return [problem, ...nodes];
  return nodes.length > 0 ? nodes : [{ type: 'message', text: 'None' }];
}

function changes(source: ExplorerSource): LocalResource[] {
  return (source.local ?? []).filter((r) => r.mark.status !== 'synced' || r.mark.drifted);
}
