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
  vi.fn(async (_target: unknown, resource: Resource, _options: { dryRun: boolean }) => {
    const name = resource.metadata.name;
    if (resource.kind === 'Application' && !exists.includes('team-a'))
      throw new ConsoleError(404, 'Group not found', `Group with id 'team-a' not found`);
    if (resource.kind === 'ApplicationInstance' && !exists.includes('shop'))
      throw new ConsoleError(
        403,
        'Forbidden',
        'Missing GovernanceApplicationsEdit (associated roles: admin) on app shop',
      );
    if (resource.kind === 'Topic') throw new ConsoleError(422, 'Policy violation', '- partitions must be at least 3');
    return { resource, upsertResult: exists.includes(name) ? ('NotChanged' as const) : ('Created' as const) };
  });

const documents = () => parseResourceDocuments(chain, { env: {} });
const byName = (items: Awaited<ReturnType<typeof planDocuments>>) =>
  Object.fromEntries(items.map((i) => [i.document.resource!.metadata.name, i.outcome]));

describe('planDocuments', () => {
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
      orders: { status: 'error', message: 'Policy violation: - partitions must be at least 3' },
    });
  });

  it('keeps a failure a failure when what it names already exists', async () => {
    const upsert = vi.fn(async (_t: unknown, resource: Resource, _o: { dryRun: boolean }) => {
      if (resource.kind === 'Application')
        throw new ConsoleError(404, 'Group not found', `Group with id 'team-a' not found`);
      return { resource, upsertResult: 'NotChanged' as const };
    });
    const items = await planDocuments(
      { upsert },
      snapshotCatalog,
      documents().filter((d) => d.kind !== 'Topic'),
    );
    expect(byName(items).shop).toMatchObject({ status: 'error' });
  });

  it('does not take a short name inside a longer word for a dependency', async () => {
    const upsert = vi.fn(async (_t: unknown, resource: Resource, _o: { dryRun: boolean }) => {
      if (resource.kind === 'Application') throw new ConsoleError(400, 'Bad request', 'team-ab is not a valid owner');
      return { resource, upsertResult: 'Created' as const };
    });
    const items = await planDocuments(
      { upsert },
      snapshotCatalog,
      documents().filter((d) => d.kind !== 'Topic' && d.kind !== 'ApplicationInstance'),
    );
    expect(byName(items).shop).toMatchObject({ status: 'error' });
  });
});

describe('upsertDocuments with stopOnError', () => {
  it('applies in order, stops at the first failure and skips the rest', async () => {
    const upsert = vi.fn(async (_t: unknown, resource: Resource, _o: { dryRun: boolean }) => {
      if (resource.kind === 'Application') throw new ConsoleError(400, 'Bad request', 'owner is invalid');
      return { resource, upsertResult: 'Created' as const };
    });
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
