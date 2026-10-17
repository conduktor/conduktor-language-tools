import { describe, expect, it, vi } from 'vitest';
import { ConsoleError } from '../src/client/errors';
import { planDocuments } from '../src/plan/planDocuments';
import { upsertDocuments } from '../src/plan/upsertDocuments';
import { parseResourceDocuments } from '../src/resources/parseDocuments';
import type { Resource } from '../src/resources/types';
import { snapshotCatalog } from './fixtures';

const chain = `apiVersion: v1
kind: ApplicationInstance
metadata: { name: shop-dev, application: shop }
spec: { cluster: local }
---
apiVersion: v1
kind: Application
metadata: { name: shop }
spec: { title: Shop, owner: team-a }
---
apiVersion: v2
kind: Group
metadata: { name: team-a }
spec: { displayName: Team A }
---
apiVersion: v2
kind: Topic
metadata: { name: orders, cluster: local }
spec: { partitions: 1 }
`;

const consoleWith = (exists: string[] = []) =>
  vi.fn((_target: unknown, resource: Resource, _options: { dryRun: boolean }) => {
    const name = resource.metadata.name;
    if (resource.kind === 'Application' && !exists.includes('team-a'))
      return Promise.reject(new ConsoleError(404, 'Group not found', `Group with id 'team-a' not found`));
    if (resource.kind === 'ApplicationInstance' && !exists.includes('shop'))
      return Promise.reject(
        new ConsoleError(403, 'Forbidden', 'Missing GovernanceApplicationsEdit (associated roles: admin) on app shop'),
      );
    if (resource.kind === 'Topic')
      return Promise.reject(new ConsoleError(422, 'Policy violation', '- partitions must be at least 3'));
    return Promise.resolve({
      resource,
      upsertResult: exists.includes(name) ? ('NotChanged' as const) : ('Created' as const),
    });
  });

// A Console where `kind` fails with `error` and everything else goes through.
const failing = (kind: string, error: ConsoleError, result: 'Created' | 'NotChanged' = 'Created') =>
  vi.fn((_t: unknown, resource: Resource, _o: { dryRun: boolean }) =>
    resource.kind === kind ? Promise.reject(error) : Promise.resolve({ resource, upsertResult: result }),
  );

const documents = () => parseResourceDocuments(chain, { env: {} });
const byName = (items: Awaited<ReturnType<typeof planDocuments>>) =>
  Object.fromEntries(items.map((i) => [i.document.resource!.metadata.name, i.outcome]));

describe('planDocuments', () => {
  it('treats what other local files create as on its way, so a dependant waits rather than fails', async () => {
    const alone = parseResourceDocuments(chain.split('---\n')[1]!, { env: {} });
    const [unseeded] = await planDocuments({ upsert: consoleWith() }, snapshotCatalog, alone);
    expect(unseeded?.outcome.status).toBe('error');
    const [seeded] = await planDocuments({ upsert: consoleWith() }, snapshotCatalog, alone, { willExist: ['team-a'] });
    expect(seeded?.outcome).toMatchObject({ status: 'pending', waitingFor: ['team-a'] });
  });

  it('reports each resource as it is checked, and stops checking when cancelled', async () => {
    const done: [number, number][] = [];
    await planDocuments({ upsert: consoleWith() }, snapshotCatalog, documents(), {
      onItem: (count, total) => done.push([count, total]),
    });
    expect(done).toEqual([
      [1, 4],
      [2, 4],
      [3, 4],
      [4, 4],
    ]);
    const upsert = consoleWith();
    const items = await planDocuments({ upsert }, snapshotCatalog, documents(), {
      cancelled: () => upsert.mock.calls.length >= 2,
    });
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(items.map((i) => i.outcome.status)).toEqual(['ok', 'pending', 'skipped', 'skipped']);
  });

  it('marks resources that wait for earlier creations as pending, in apply order', async () => {
    const items = await planDocuments({ upsert: consoleWith() }, snapshotCatalog, documents());
    expect(items.map((i) => i.document.kind)).toEqual(['Group', 'Application', 'ApplicationInstance', 'Topic']);
    expect(byName(items)).toEqual({
      'team-a': { status: 'ok', result: 'Created' },
      shop: { status: 'pending', waitingFor: ['team-a'], message: "Group not found: Group with id 'team-a' not found" },
      'shop-dev': {
        status: 'pending',
        waitingFor: ['shop'],
        message: 'Forbidden: Missing GovernanceApplicationsEdit (associated roles: admin) on app shop',
      },
      orders: { status: 'error', message: 'Policy violation: - partitions must be at least 3', httpStatus: 422 },
    });
  });

  it.each([
    [
      'what it names already exists',
      new ConsoleError(404, 'Group not found', "Group with id 'team-a' not found"),
      'NotChanged',
    ],
    [
      'the name is only part of a longer word',
      new ConsoleError(404, 'Not found', 'team-ab is not a valid owner'),
      'Created',
    ],
    [
      'it is not a not-found or no-permission error',
      new ConsoleError(422, 'Policy violation', 'owner team-a must have a description'),
      'Created',
    ],
  ] as const)('keeps a failure a failure when %s', async (_, error, result) => {
    const items = await planDocuments(
      { upsert: failing('Application', error, result) },
      snapshotCatalog,
      documents().filter((d) => d.kind === 'Group' || d.kind === 'Application'),
    );
    expect(byName(items).shop).toMatchObject({ status: 'error' });
  });

  it("does not take a resource's own name in its error for a dependency", async () => {
    const yaml = `apiVersion: v1
kind: Application
metadata: { name: payments }
spec: { title: Payments, owner: team-a }
---
apiVersion: v2
kind: Topic
metadata: { name: payments, cluster: local }
spec: { partitions: 1 }
`;
    const upsert = failing('Topic', new ConsoleError(403, 'Forbidden', 'Topic payments violates policy p1'));
    const items = await planDocuments({ upsert }, snapshotCatalog, parseResourceDocuments(yaml));
    expect(items.map((i) => [i.document.kind, i.outcome.status])).toEqual([
      ['Application', 'ok'],
      ['Topic', 'error'],
    ]);
  });
});

describe('upsertDocuments with stopOnError', () => {
  it('applies in order, stops at the first failure and skips the rest', async () => {
    const upsert = failing('Application', new ConsoleError(400, 'Bad request', 'owner is invalid'));
    const items = await upsertDocuments({ upsert }, snapshotCatalog, documents(), { dryRun: false, stopOnError: true });
    expect(items.map((i) => [i.document.kind, i.outcome.status])).toEqual([
      ['Group', 'ok'],
      ['Application', 'error'],
      ['ApplicationInstance', 'skipped'],
      ['Topic', 'skipped'],
    ]);
    expect(upsert).toHaveBeenCalledTimes(2);
  });
});
