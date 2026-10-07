import { describe, expect, it } from 'vitest';
import { ConsoleError } from '../src/client/errors';
import type { Resource } from '../src/resources/types';
import { bootstrapProgress, collectResources, describeBootstrap, type BootstrapStage } from '../src/sync/bootstrap';
import { snapshotCatalog } from './fixtures';

const named = (...names: string[]) => names.map((name) => ({ metadata: { name } }) as Resource);

function console_(responses: Record<string, Resource[] | Error>) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    calls,
    maxInFlight: () => maxInFlight,
    client: {
      list: async (path: string) => {
        calls.push(path);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        const response = responses[path];
        if (response instanceof Error) throw response;
        return response ?? [];
      },
    },
  };
}

const responses = {
  '/public/console/v2/kafka-cluster': named('local', 'prod'),
  '/public/iam/v2/group': named('team-a'),
  '/public/kafka/v2/cluster/local/topic': named('orders'),
  '/public/kafka/v2/cluster/prod/topic': new ConsoleError(403, 'Forbidden'),
  '/public/console/v2/cluster/local/kafka-connect': named('main'),
  '/public/console/v2/cluster/prod/kafka-connect': new Error('connect is down'),
  '/public/kafka/v2/cluster/local/connect/main/connector': named('sink'),
};

describe('collectResources', () => {
  it('walks global kinds and every cluster, through nested parents', async () => {
    const { client } = console_(responses);
    const { fetched, skipped, cancelled } = await collectResources(client, snapshotCatalog, [
      'Topic',
      'Group',
      'KafkaCluster',
      'Connector',
    ]);
    expect(cancelled).toBe(false);
    expect(fetched.map((f) => [f.kind.kind, f.parents, f.resource.metadata.name])).toEqual([
      ['Group', [], 'team-a'],
      ['KafkaCluster', [], 'local'],
      ['KafkaCluster', [], 'prod'],
      ['Topic', ['local'], 'orders'],
      ['Connector', ['local', 'main'], 'sink'],
    ]);
    expect(skipped).toEqual([
      { kind: 'Connector', parents: ['prod'], reason: 'connect is down' },
      { kind: 'Topic', parents: ['prod'], reason: 'No access' },
    ]);
  });

  it('lists each parent once and at most four lists at a time, parents included', async () => {
    const clusters = Array.from({ length: 10 }, (_, i) => `c${i}`);
    const fake = console_({ '/public/console/v2/kafka-cluster': named(...clusters) });
    await collectResources(fake.client, snapshotCatalog, ['Topic', 'Connector', 'KafkaCluster']);
    expect(fake.calls.filter((c) => c === '/public/console/v2/kafka-cluster')).toHaveLength(1);
    expect(fake.calls.filter((c) => c.endsWith('/kafka-connect'))).toHaveLength(10);
    expect(fake.maxInFlight()).toBeLessThanOrEqual(4);
  });

  it('leaves out built-in resources, which the Console owns and will not take back', async () => {
    const { client } = console_({
      '/public/data-quality/v1/data-quality-rule': [
        { metadata: { name: 'enforce_avro', builtIn: true } },
        { metadata: { name: 'mine' } },
      ] as Resource[],
    });
    const { fetched, skipped, builtIn } = await collectResources(client, snapshotCatalog, ['DataQualityRule']);
    expect(fetched.map((f) => f.resource.metadata.name)).toEqual(['mine']);
    expect(builtIn).toEqual(['DataQualityRule enforce_avro']);
    expect(skipped).toEqual([]);
  });

  it('skips a kind this Console does not have', async () => {
    const { client } = console_(responses);
    const { skipped } = await collectResources(client, snapshotCatalog, ['NoSuchKind']);
    expect(skipped).toEqual([{ kind: 'NoSuchKind', parents: [], reason: 'Not on this Console' }]);
  });

  it('stops when cancelled and says so', async () => {
    const { client } = console_(responses);
    let lists = 0;
    const { cancelled, fetched } = await collectResources(client, snapshotCatalog, ['Group', 'Topic', 'KafkaCluster'], {
      concurrency: 1,
      cancelled: () => lists > 0,
      onProgress: (stage) => {
        if (stage.stage === 'listing') lists++;
      },
    });
    expect(cancelled).toBe(true);
    expect(fetched.length).toBeLessThan(4);
  });
});

describe('bootstrap progress', () => {
  it('finds the parents first, then counts every list, the resources it brought and what is still out', async () => {
    const { client } = console_(responses);
    const stages: BootstrapStage[] = [];
    const { fetched } = await collectResources(client, snapshotCatalog, ['Group', 'Topic', 'KafkaCluster'], {
      onProgress: (stage) => stages.push(stage),
    });
    expect(stages[0]).toEqual({ stage: 'finding' });
    const listing = stages.slice(1);
    expect(listing.every((s) => s.stage === 'listing')).toBe(true);
    expect(listing.at(-1)).toEqual({
      stage: 'listing',
      done: listing.length,
      total: listing.length,
      resources: fetched.length,
      waiting: [],
    });
    const first = listing[0]!;
    expect(first.stage === 'listing' && first.waiting.length).toBe(listing.length - 1);
  });

  it('says what each stage is doing, what it waits on, and weights the bar towards listing', () => {
    const stages: BootstrapStage[] = [
      { stage: 'finding' },
      { stage: 'listing', done: 12, total: 40, resources: 1830, waiting: ['Topic in a', 'Topic in b', 'Group', 'X'] },
      { stage: 'listing', done: 39, total: 40, resources: 3120, waiting: ['ServiceAccount in local-gateway'] },
      { stage: 'listing', done: 40, total: 40, resources: 3120, waiting: [] },
      { stage: 'writing', done: 1200, total: 3120 },
      { stage: 'writing', done: 3120, total: 3120 },
      { stage: 'indexing' },
      { stage: 'envExample' },
    ];
    const reports = stages.map((stage) => bootstrapProgress(stage));
    expect(reports.map((r) => r.message)).toEqual([
      'Finding clusters and Connect clusters…',
      'Listing 12 of 40 (1,830 resources), waiting on Topic in a, Topic in b and 2 more',
      'Listing 39 of 40 (3,120 resources), waiting on ServiceAccount in local-gateway',
      'Listing 40 of 40 (3,120 resources)',
      'Writing files: 1,200 of 3,120',
      'Writing files: 3,120 of 3,120',
      'Indexing the folder…',
      'Writing .env.example…',
    ]);
    expect(reports.map((r) => r.percent)).toEqual([0, 27, 87.75, 90, 93.08, 98, 98, 99]);
    expect(bootstrapProgress({ stage: 'writing', done: 0, total: 0 }).percent).toBe(90);
    expect(bootstrapProgress(stages[2]!, 23_400).message).toBe(
      'Listing 39 of 40 (3,120 resources), waiting on ServiceAccount in local-gateway, 23 s',
    );
  });
});

describe('describeBootstrap', () => {
  it('counts what was written per kind and lists the rest', () => {
    const summary = describeBootstrap('dev', {
      written: { Topic: 3, Group: 1 },
      unchanged: 5,
      conflicts: ['clusters/local/kafka/Topic/orders.yaml'],
      skipped: [{ kind: 'Topic', parents: ['prod'], reason: 'No access' }],
      builtIn: ['DataQualityRule enforce_avro'],
      cancelled: false,
    });
    expect(summary.headline).toBe('dev: 4 written, 5 unchanged, 1 left alone, 1 skipped, 1 built in left out.');
    expect(summary.details).toEqual([
      'Written: Topic 3, Group 1',
      'Left alone (local changes or not a synced copy): clusters/local/kafka/Topic/orders.yaml',
      'Skipped Topic in prod: No access',
      'Left out, built in and managed by the Console: DataQualityRule enforce_avro',
    ]);
  });
});
