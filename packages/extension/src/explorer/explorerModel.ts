import {
  ConsoleError,
  describeError,
  listPath,
  parentsOf,
  type ConsoleClient,
  type KindCatalog,
  type KindVersion,
} from '@conduktor/vscode-core';

export type ExplorerNode =
  | { type: 'group'; group: string }
  | { type: 'kind'; kind: KindVersion }
  | { type: 'parent'; kind: KindVersion; parents: string[] }
  | { type: 'resource'; kind: KindVersion; parents: string[]; name: string }
  | { type: 'message'; text: string; detail?: string; noAccess?: boolean };

export type ResourceNode = Extract<ExplorerNode, { type: 'resource' }>;

export interface ExplorerSource {
  catalog: KindCatalog;
  client: Pick<ConsoleClient, 'list'>;
}

export const PARENT_KINDS: Readonly<Record<string, string>> = {
  cluster: 'KafkaCluster',
  connectCluster: 'KafkaConnectCluster',
};

export async function childrenOf(source: ExplorerSource, node?: ExplorerNode): Promise<ExplorerNode[]> {
  if (!node) {
    return [...new Set(latestKinds(source.catalog).map((k) => k.group))]
      .sort()
      .map((group) => ({ type: 'group', group }));
  }
  switch (node.type) {
    case 'group':
      return latestKinds(source.catalog)
        .filter((kind) => kind.group === node.group)
        .map((kind) => ({ type: 'kind', kind }));
    case 'kind':
      return nextLevel(source, node.kind, []);
    case 'parent':
      return nextLevel(source, node.kind, node.parents);
    default:
      return [];
  }
}

function latestKinds(catalog: KindCatalog): KindVersion[] {
  return [...catalog.kindNames()]
    .map((name) => catalog.latest(name)!)
    .sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind));
}

async function nextLevel(source: ExplorerSource, kind: KindVersion, parents: string[]): Promise<ExplorerNode[]> {
  const param = kind.parentPathParams[parents.length];
  if (param !== undefined) {
    const parentKindName = PARENT_KINDS[param];
    const parentKind = parentKindName ? source.catalog.latest(parentKindName) : undefined;
    if (!parentKind) return [{ type: 'message', text: `Browsing by ${param} is not supported` }];
    return guarded(async () =>
      names(await source.client.list(listPath(parentKind, parentsOf(kind, parents)))).map((name) => ({
        type: 'parent',
        kind,
        parents: [...parents, name],
      })),
    );
  }
  return guarded(async () =>
    names(await source.client.list(listPath(kind, parentsOf(kind, parents)))).map((name) => ({
      type: 'resource',
      kind,
      parents,
      name,
    })),
  );
}

function names(resources: readonly { metadata: { name: string } }[]): string[] {
  return resources.map((r) => r.metadata.name).sort((a, b) => a.localeCompare(b));
}

async function guarded(load: () => Promise<ExplorerNode[]>): Promise<ExplorerNode[]> {
  try {
    const nodes = await load();
    return nodes.length > 0 ? nodes : [{ type: 'message', text: 'None' }];
  } catch (error) {
    if (error instanceof ConsoleError && error.status === 403) {
      return [{ type: 'message', text: 'No access', detail: error.message, noAccess: true }];
    }
    return [{ type: 'message', text: 'Failed to load', detail: describeError(error) }];
  }
}
