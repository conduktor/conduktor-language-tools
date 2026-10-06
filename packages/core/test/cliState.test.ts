import { describe, expect, it } from 'vitest';
import { leftState, planWarnings } from '../src/cli';
import { snapshotCatalog } from './fixtures';

const state = (...resources: { kind: string; metadata: Record<string, unknown> }[]) =>
  JSON.stringify({ version: 'v1', resources: resources.map((r) => ({ apiVersion: 'v2', ...r })) });
const topic = (name: string, extra: Record<string, unknown> = {}) => ({
  kind: 'Topic',
  metadata: { name, cluster: 'c', ...extra },
});

describe('leftState', () => {
  it('names what an apply deleted, by kind, parents and name', () => {
    expect(leftState(state(topic('a'), topic('b')), state(topic('b')), snapshotCatalog)).toEqual([
      { kind: 'Topic', parents: ['c'], name: 'a' },
    ]);
  });

  it('does not count a resource ctl recreated with other metadata as deleted', () => {
    expect(leftState(state(topic('a')), state(topic('a', { description: 'new' })), snapshotCatalog)).toEqual([]);
  });

  it('reads a missing or unreadable state as empty', () => {
    expect(leftState(undefined, state(topic('a')), snapshotCatalog)).toEqual([]);
    expect(leftState('not json', undefined, snapshotCatalog)).toEqual([]);
  });
});

describe('planWarnings', () => {
  it('lists the deletes, and flags a delete of something the same run applies again', () => {
    expect(
      planWarnings([
        { kind: 'Topic', name: 'gone', result: 'Deleted' },
        { kind: 'Topic', name: 'orders', result: 'Deleted' },
        { kind: 'Topic', name: 'orders', result: 'Updated' },
        { kind: 'Topic', name: 'kept', result: 'NotChanged' },
      ]),
    ).toEqual({ deleted: ['Topic/gone', 'Topic/orders'], recreated: ['Topic/orders'] });
  });
});
