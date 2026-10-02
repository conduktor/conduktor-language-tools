import { readFileSync } from 'node:fs';
import { buildSpec, ConsoleError, type Resource } from '@conduktor/vscode-core';
import { describe, expect, it } from 'vitest';
import { childrenOf, type ExplorerNode, type ExplorerSource } from '../src/explorer/explorerModel';

const { catalog } = buildSpec(
  readFileSync(new URL('../../core/snapshot/public-api-doc.yaml', import.meta.url), 'utf8'),
  'snapshot',
);
const named = (...names: string[]) => names.map((name) => ({ metadata: { name } }) as Resource);

function source(responses: Record<string, Resource[] | Error>, extra: Partial<ExplorerSource> = {}): ExplorerSource {
  return {
    catalog,
    cluster: 'local',
    client: {
      list: async (path: string) => {
        const response = responses[path];
        if (response instanceof Error) throw response;
        if (!response) throw new Error(`unexpected ${path}`);
        return response;
      },
    },
    ...extra,
  };
}

const find = (nodes: ExplorerNode[], predicate: (n: ExplorerNode) => boolean) => {
  const node = nodes.find(predicate);
  expect(node).toBeDefined();
  return node!;
};
const kindNode = (name: string, parents: string[] = []) =>
  ({ type: 'kind', kind: catalog.latest(name)!, parents }) as const;
const kindsUnder = async (s: ExplorerSource, scope: 'global' | 'cluster') =>
  (await Promise.all((await childrenOf(s, { type: 'scope', scope })).map((group) => childrenOf(s, group))))
    .flat()
    .map((n) => n.type === 'kind' && n.kind.kind);

describe('childrenOf', () => {
  it('splits the tree into global resources and the selected cluster', async () => {
    expect(await childrenOf(source({}))).toEqual([
      { type: 'scope', scope: 'global' },
      { type: 'scope', scope: 'cluster', cluster: 'local' },
    ]);
  });

  it('puts kinds that live in a Kafka cluster under the cluster, and the rest under global', async () => {
    const global = await kindsUnder(source({}), 'global');
    const cluster = await kindsUnder(source({}), 'cluster');
    expect(global).toEqual(
      expect.arrayContaining(['User', 'Group', 'KafkaCluster', 'Application', 'ApplicationInstance', 'Alert']),
    );
    expect(cluster).toEqual(
      expect.arrayContaining(['Topic', 'Subject', 'Connector', 'KafkaConnectCluster', 'ServiceAccount']),
    );
    expect(global.filter((k) => cluster.includes(k))).toEqual([]);
  });

  it('groups kinds by API group in apply order, latest version only', async () => {
    const s = source({});
    const monitoring = find(
      await childrenOf(s, { type: 'scope', scope: 'global' }),
      (n) => n.type === 'group' && n.group === 'monitoring',
    );
    const kinds = await childrenOf(s, monitoring);
    expect(kinds.filter((n) => n.type === 'kind' && n.kind.kind === 'Alert')).toEqual([kindNode('Alert')]);
    expect(catalog.latest('Alert')?.version).toBe(3);
  });

  it("lists a cluster kind's resources straight from the selected cluster", async () => {
    const s = source({ '/public/kafka/v2/cluster/local/topic': named('b', 'a') });
    const kafka = find(
      await childrenOf(s, { type: 'scope', scope: 'cluster', cluster: 'local' }),
      (n) => n.type === 'group' && n.group === 'kafka',
    );
    const topic = find(await childrenOf(s, kafka), (n) => n.type === 'kind' && n.kind.kind === 'Topic');
    expect(topic).toEqual(kindNode('Topic', ['local']));
    expect((await childrenOf(s, topic)).map((n) => n.type === 'resource' && [n.name, n.parents])).toEqual([
      ['a', ['local']],
      ['b', ['local']],
    ]);
  });

  it('keeps the Connect cluster level for connectors', async () => {
    const s = source({
      '/public/console/v2/cluster/local/kafka-connect': named('main'),
      '/public/kafka/v2/cluster/local/connect/main/connector': named('sink-b', 'sink-a'),
    });
    const connects = await childrenOf(s, kindNode('Connector', ['local']));
    expect(connects).toEqual([{ type: 'parent', kind: catalog.latest('Connector'), parents: ['local', 'main'] }]);
    expect((await childrenOf(s, connects[0])).map((n) => n.type === 'resource' && n.name)).toEqual([
      'sink-a',
      'sink-b',
    ]);
  });

  it('asks for a cluster when none is selected', async () => {
    const s = source({}, { cluster: undefined });
    expect(await childrenOf(s)).toEqual([
      { type: 'scope', scope: 'global' },
      { type: 'scope', scope: 'cluster' },
    ]);
    expect(await childrenOf(s, { type: 'scope', scope: 'cluster' })).toEqual([
      { type: 'message', text: 'Select a cluster…', selectCluster: true },
    ]);
  });

  it('lists global kinds directly', async () => {
    const s = source({ '/public/self-serve/v1/application': named('shop') });
    expect(await childrenOf(s, kindNode('Application'))).toEqual([
      { type: 'resource', kind: catalog.latest('Application'), parents: [], name: 'shop' },
    ]);
  });

  it('shows no access for a 403 and the error otherwise', async () => {
    const s = source({
      '/public/iam/v2/user': new ConsoleError(403, 'Forbidden'),
      '/public/iam/v2/group': new Error('boom'),
    });
    expect(await childrenOf(s, kindNode('User'))).toEqual([
      { type: 'message', text: 'No access', detail: 'Forbidden', noAccess: true },
    ]);
    expect(await childrenOf(s, kindNode('Group'))).toEqual([
      { type: 'message', text: 'Failed to load', detail: 'boom' },
    ]);
  });

  it('says when a list is empty', async () => {
    const s = source({ '/public/self-serve/v1/application': [] });
    expect(await childrenOf(s, kindNode('Application'))).toEqual([{ type: 'message', text: 'None' }]);
  });
});

describe('childrenOf with a sync folder', () => {
  const mark = (status: 'new' | 'modified' | 'synced', drifted = false) => ({
    status,
    drifted,
    uri: `file:///${status}`,
  });
  const local = [
    { kind: 'Topic', parents: ['local'], name: 'a', mark: mark('modified') },
    { kind: 'Topic', parents: ['local'], name: 'c', mark: mark('new') },
    { kind: 'Topic', parents: ['staging'], name: 'z', mark: mark('new') },
    { kind: 'Topic', parents: ['local'], name: 'b', mark: mark('synced') },
    { kind: 'Application', parents: [], name: 'shop', mark: mark('synced', true) },
  ];

  it('merges the selected cluster’s local resources into the live list, with their marks', async () => {
    const s = source({ '/public/kafka/v2/cluster/local/topic': named('a', 'b', 'd') }, { local });
    expect(
      (await childrenOf(s, kindNode('Topic', ['local']))).map(
        (n) => n.type === 'resource' && [n.name, n.local?.status ?? 'live'],
      ),
    ).toEqual([
      ['a', 'modified'],
      ['b', 'synced'],
      ['c', 'new'],
      ['d', 'live'],
    ]);
  });

  it('shows only the changes for global resources and the selected cluster, without asking the Console', async () => {
    const s = source({}, { local, onlyChanges: true });
    expect(await childrenOf(s)).toEqual([
      { type: 'scope', scope: 'global' },
      { type: 'scope', scope: 'cluster', cluster: 'local' },
    ]);
    expect(await kindsUnder(s, 'global')).toEqual(['Application']);
    expect(await kindsUnder(s, 'cluster')).toEqual(['Topic']);
    expect((await childrenOf(s, kindNode('Topic', ['local']))).map((n) => n.type === 'resource' && n.name)).toEqual([
      'a',
      'c',
    ]);
    expect(
      (await childrenOf(s, kindNode('Application'))).map((n) => n.type === 'resource' && [n.name, n.local?.drifted]),
    ).toEqual([['shop', true]]);
  });

  it('leaves out a scope with no changes', async () => {
    const s = source({}, { local: local.filter((r) => r.kind === 'Topic'), onlyChanges: true, cluster: 'staging' });
    expect(await childrenOf(s)).toEqual([{ type: 'scope', scope: 'cluster', cluster: 'staging' }]);
  });

  it('still shows local work when the Console list fails', async () => {
    const s = source({ '/public/kafka/v2/cluster/local/topic': new Error('down') }, { local });
    expect(
      (await childrenOf(s, kindNode('Topic', ['local']))).map((n) =>
        n.type === 'resource' ? n.name : n.type === 'message' ? n.text : '',
      ),
    ).toEqual(['Failed to load', 'a', 'b', 'c']);
  });
});
