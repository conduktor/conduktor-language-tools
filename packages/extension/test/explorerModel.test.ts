import { readFileSync } from 'node:fs';
import { buildSpec, ConsoleError, type Resource } from '@conduktor/vscode-core';
import { describe, expect, it } from 'vitest';
import { childrenOf, type ExplorerNode } from '../src/explorer/explorerModel';

const { catalog } = buildSpec(
  readFileSync(new URL('../../core/snapshot/public-api-doc.yaml', import.meta.url), 'utf8'),
  'snapshot',
);
const named = (...names: string[]) => names.map((name) => ({ metadata: { name } }) as Resource);

function source(responses: Record<string, Resource[] | Error>) {
  return {
    catalog,
    client: {
      list: async (path: string) => {
        const response = responses[path];
        if (response instanceof Error) throw response;
        if (!response) throw new Error(`unexpected ${path}`);
        return response;
      },
    },
  };
}

const find = (nodes: ExplorerNode[], predicate: (n: ExplorerNode) => boolean) => {
  const node = nodes.find(predicate);
  expect(node).toBeDefined();
  return node!;
};

describe('childrenOf', () => {
  it('groups kinds by resource group in apply order, latest version only', async () => {
    const roots = await childrenOf(source({}));
    expect(roots.map((n) => n.type === 'group' && n.group)).toContain('kafka');
    const monitoring = find(roots, (n) => n.type === 'group' && n.group === 'monitoring');
    const kinds = await childrenOf(source({}), monitoring);
    expect(kinds.filter((n) => n.type === 'kind' && n.kind.kind === 'Alert')).toHaveLength(1);
    expect(kinds.find((n) => n.type === 'kind' && n.kind.kind === 'Alert')).toMatchObject({ kind: { version: 3 } });
  });

  it('walks cluster then Connect cluster before listing connectors', async () => {
    const s = source({
      '/public/console/v2/kafka-cluster': named('local'),
      '/public/console/v2/cluster/local/kafka-connect': named('main'),
      '/public/kafka/v2/cluster/local/connect/main/connector': named('sink-b', 'sink-a'),
    });
    const connector = { type: 'kind', kind: catalog.latest('Connector')! } as const;
    const clusters = await childrenOf(s, connector);
    expect(clusters).toEqual([{ type: 'parent', kind: connector.kind, parents: ['local'] }]);
    const connects = await childrenOf(s, clusters[0]);
    expect(connects).toEqual([{ type: 'parent', kind: connector.kind, parents: ['local', 'main'] }]);
    const connectors = await childrenOf(s, connects[0]);
    expect(connectors.map((n) => n.type === 'resource' && n.name)).toEqual(['sink-a', 'sink-b']);
  });

  it('lists parentless kinds directly', async () => {
    const s = source({ '/public/self-serve/v1/application': named('shop') });
    const nodes = await childrenOf(s, { type: 'kind', kind: catalog.latest('Application')! });
    expect(nodes).toEqual([{ type: 'resource', kind: catalog.latest('Application'), parents: [], name: 'shop' }]);
  });

  it('shows no access for a 403 and the error otherwise', async () => {
    const s = source({
      '/public/iam/v2/user': new ConsoleError(403, 'Forbidden'),
      '/public/iam/v2/group': new Error('boom'),
    });
    expect(await childrenOf(s, { type: 'kind', kind: catalog.latest('User')! })).toEqual([
      { type: 'message', text: 'No access', detail: 'Forbidden', noAccess: true },
    ]);
    expect(await childrenOf(s, { type: 'kind', kind: catalog.latest('Group')! })).toEqual([
      { type: 'message', text: 'Failed to load', detail: 'boom' },
    ]);
  });

  it('says when a list is empty', async () => {
    const s = source({ '/public/self-serve/v1/application': [] });
    expect(await childrenOf(s, { type: 'kind', kind: catalog.latest('Application')! })).toEqual([
      { type: 'message', text: 'None' },
    ]);
  });
});
