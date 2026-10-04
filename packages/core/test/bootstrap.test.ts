import { describe, expect, it } from 'vitest';
import { ConsoleError } from '../src/client/errors';
import type { Resource } from '../src/resources/types';
import { collectResources, describeBootstrap } from '../src/sync/bootstrap';
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

  it('lists each parent once and at most four lists at a time', async () => {
    const fake = console_(responses);
    await collectResources(fake.client, snapshotCatalog, ['Topic', 'Connector', 'KafkaCluster']);
    expect(fake.calls.filter((c) => c === '/public/console/v2/kafka-cluster')).toHaveLength(1);
    expect(fake.maxInFlight()).toBeLessThanOrEqual(4);
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
      onProgress: () => lists++,
    });
    expect(cancelled).toBe(true);
    expect(fetched.length).toBeLessThan(4);
  });
});

describe('describeBootstrap', () => {
  it('counts what was written per kind and lists the rest', () => {
    const summary = describeBootstrap('dev', {
      written: { Topic: 3, Group: 1 },
      unchanged: 5,
      conflicts: ['clusters/local/kafka/Topic/orders.yaml'],
      skipped: [{ kind: 'Topic', parents: ['prod'], reason: 'No access' }],
      cancelled: false,
    });
    expect(summary.headline).toBe('dev: 4 written, 5 unchanged, 1 left alone, 1 skipped.');
    expect(summary.details).toEqual([
      'Written: Topic 3, Group 1',
      'Left alone (local changes or not a synced copy): clusters/local/kafka/Topic/orders.yaml',
      'Skipped Topic in prod: No access',
    ]);
  });
});
