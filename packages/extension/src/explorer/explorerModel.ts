import {
  ConsoleError,
  describeError,
  listPath,
  parentsOf,
  PARENT_KINDS,
  type ConsoleClient,
  type KindCatalog,
  type Drift,
  type KindVersion,
  type SyncStatus,
} from '@conduktor/vscode-core';

export interface LocalMark {
  status: SyncStatus;
  drift?: Drift;
  uri: string;
}

export interface LocalResource {
  kind: string;
  parents: string[];
  name: string;
  mark: LocalMark;
}

export type Scope = 'global' | 'cluster';

export type ExplorerNode =
  | { type: 'scope'; scope: Scope; cluster?: string }
  | { type: 'group'; group: string; scope: Scope }
  | { type: 'kind'; kind: KindVersion; parents: string[] }
  | { type: 'parent'; kind: KindVersion; parents: string[] }
  | { type: 'resource'; kind: KindVersion; parents: string[]; name: string; local?: LocalMark }
  | { type: 'message'; text: string; detail?: string; noAccess?: boolean; selectCluster?: boolean };

export type ResourceNode = Extract<ExplorerNode, { type: 'resource' }>;

export interface ExplorerSource {
  catalog: KindCatalog;
  client: Pick<ConsoleClient, 'list'>;
  cluster?: string;
  local?: readonly LocalResource[];
  onlyChanges?: boolean;
}

export async function childrenOf(source: ExplorerSource, node?: ExplorerNode): Promise<ExplorerNode[]> {
  if (!node) {
    const scopes: ExplorerNode[] = [
      { type: 'scope', scope: 'global' },
      { type: 'scope', scope: 'cluster', ...(source.cluster && { cluster: source.cluster }) },
    ];
    return source.onlyChanges
      ? scopes.filter((n) => n.type === 'scope' && visibleKinds(source, n.scope).length > 0)
      : scopes;
  }
  switch (node.type) {
    case 'scope':
      if (node.scope === 'cluster' && !source.cluster) {
        return [{ type: 'message', text: 'Select a cluster…', selectCluster: true }];
      }
      return [...new Set(visibleKinds(source, node.scope).map((k) => k.group))]
        .sort()
        .map((group) => ({ type: 'group', group, scope: node.scope }));
    case 'group':
      return visibleKinds(source, node.scope)
        .filter((kind) => kind.group === node.group)
        .map((kind) => ({ type: 'kind', kind, parents: node.scope === 'cluster' ? [source.cluster!] : [] }));
    case 'kind':
    case 'parent':
      return nextLevel(source, node.kind, node.parents);
    default:
      return [];
  }
}

/** The node above this one, as childrenOf builds the tree: what a reveal walks up through. */
export function parentOf(node: ExplorerNode, cluster: string | undefined): ExplorerNode | undefined {
  switch (node.type) {
    case 'resource':
    case 'parent': {
      const parents = node.type === 'resource' ? node.parents : node.parents.slice(0, -1);
      const kindLevel = scopeOf(node.kind) === 'cluster' ? 1 : 0;
      return parents.length > kindLevel
        ? { type: 'parent', kind: node.kind, parents }
        : { type: 'kind', kind: node.kind, parents };
    }
    case 'kind':
      return { type: 'group', group: node.kind.group, scope: scopeOf(node.kind) };
    case 'group':
      return node.scope === 'cluster'
        ? { type: 'scope', scope: 'cluster', ...(cluster && { cluster }) }
        : { type: 'scope', scope: 'global' };
    default:
      return undefined;
  }
}

/** A stable id for a tree item, the same whatever its local status, so a reveal and the expanded state find it. */
export function idOf(node: ExplorerNode): string | undefined {
  switch (node.type) {
    case 'scope':
      return `scope:${node.scope}`;
    case 'group':
      return `group:${node.scope}:${node.group}`;
    case 'kind':
    case 'parent':
      return `${node.type}:${node.kind.kind}:${node.parents.join('/')}`;
    case 'resource':
      return `resource:${node.kind.kind}:${node.parents.join('/')}:${node.name}`;
    default:
      return undefined;
  }
}

/**
 * A path that mirrors the tree (scope / group / kind / parents below the cluster / name), so each node's path is its
 * ancestors' plus one segment, and a decoration on a resource can roll up to them.
 */
export function treePathOf(node: ExplorerNode): string | undefined {
  const path = (...parts: string[]) => `/${parts.map(encodeURIComponent).join('/')}`;
  switch (node.type) {
    case 'scope':
      return path(node.scope);
    case 'group':
      return path(node.scope, node.group);
    case 'kind':
    case 'parent':
    case 'resource': {
      const below = scopeOf(node.kind) === 'cluster' ? node.parents.slice(1) : node.parents;
      const levels = node.type === 'kind' ? [] : below;
      const name = node.type === 'resource' ? [node.name] : [];
      return path(scopeOf(node.kind), node.kind.group, node.kind.kind, ...levels, ...name);
    }
    default:
      return undefined;
  }
}

/** The resource at a tree path, its parents below the cluster (the cluster being the selected one); else undefined. */
export function resourceAtTreePath(
  path: string,
  catalog: KindCatalog,
): { kind: KindVersion; parents: string[]; name: string } | undefined {
  const [scope, group, kindName, ...rest] = path.split('/').slice(1).map(decodeURIComponent);
  const kind = kindName ? catalog.latest(kindName) : undefined;
  if (!kind || kind.group !== group || scopeOf(kind) !== scope) return undefined;
  const levels = kind.parentPathParams.length - (scope === 'cluster' ? 1 : 0);
  if (rest.length !== levels + 1) return undefined;
  return { kind, parents: rest.slice(0, -1), name: rest.at(-1)! };
}

export function scopeOf(kind: KindVersion): Scope {
  return kind.parentPathParams[0] === 'cluster' ? 'cluster' : 'global';
}

function visibleKinds(source: ExplorerSource, scope: Scope): KindVersion[] {
  const changed = source.onlyChanges ? new Set(relevantChanges(source).map((r) => r.kind)) : undefined;
  return [...source.catalog.kindNames()]
    .map((name) => source.catalog.latest(name)!)
    .filter((kind) => scopeOf(kind) === scope && (!changed || changed.has(kind.kind)))
    .sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind));
}

async function nextLevel(source: ExplorerSource, kind: KindVersion, parents: string[]): Promise<ExplorerNode[]> {
  const locals = (source.onlyChanges ? relevantChanges(source) : (source.local ?? [])).filter(
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

// Global resources and the selected cluster: what the tree shows is what Apply All Changes applies.
export function isInView(
  catalog: KindCatalog,
  cluster: string | undefined,
  resource: { kind: string; parents: readonly string[] },
): boolean {
  const kind = catalog.latest(resource.kind);
  return !!kind && (scopeOf(kind) === 'global' || resource.parents[0] === cluster);
}

function relevantChanges(source: ExplorerSource): LocalResource[] {
  return (source.local ?? []).filter((r) => isInView(source.catalog, source.cluster, r) && isChange(r.mark));
}

function isChange(mark: LocalMark): boolean {
  return mark.status !== 'synced' || !!mark.drift;
}

/** Whether the tree shows this resource: in the selected cluster, and not filtered out by Show Only Changes. */
export function shownInTree(
  catalog: KindCatalog,
  cluster: string | undefined,
  onlyChanges: boolean,
  node: ResourceNode,
): boolean {
  if (!isInView(catalog, cluster, { kind: node.kind.kind, parents: node.parents })) return false;
  return !onlyChanges || (!!node.local && isChange(node.local));
}
