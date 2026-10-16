import { describe, expect, it } from 'vitest';
import { settleCluster, type ClusterMemory } from '../src/explorer/settleCluster';

interface State {
  id: string;
}

function memory(initial: Record<string, string | undefined>, current: { state: State }) {
  const stored = { ...initial };
  const shown: (string | undefined)[] = [];
  const store: ClusterMemory<State> = {
    isCurrent: (state) => current.state === state,
    remembered: (state) => stored[state.id],
    remember: async (state, cluster) => {
      stored[state.id] = cluster;
    },
    show: async (cluster) => {
      shown.push(cluster);
    },
  };
  return { store, stored, shown };
}

describe('settleCluster', () => {
  const a = { id: 'a' };
  const b = { id: 'b' };

  it('keeps a remembered cluster that still exists', async () => {
    const { store, stored, shown } = memory({ a: 'prod' }, { state: a });
    await settleCluster(a, async () => ['dev', 'prod'], store);
    expect(stored).toEqual({ a: 'prod' });
    expect(shown).toEqual(['prod']);
  });

  it('picks the only cluster, and forgets one that is gone', async () => {
    const only = memory({ a: 'old' }, { state: a });
    await settleCluster(a, async () => ['dev'], only.store);
    expect(only.stored).toEqual({ a: 'dev' });

    const many = memory({ a: 'old' }, { state: a });
    await settleCluster(a, async () => ['dev', 'prod'], many.store);
    expect(many.stored).toEqual({ a: undefined });
    expect(many.shown).toEqual([undefined]);
  });

  it("leaves the next connection's cluster alone when the session switched while listing", async () => {
    const current = { state: a };
    const { store, stored, shown } = memory({ a: 'old', b: 'staging' }, current);
    await settleCluster(
      a,
      async () => {
        current.state = b;
        return ['dev'];
      },
      store,
    );
    expect(stored).toEqual({ a: 'old', b: 'staging' });
    expect(shown).toEqual([]);
  });

  it('does not show a cluster for a session that switched while it was remembered', async () => {
    const current = { state: a };
    const { store, shown } = memory({}, current);
    const remember = store.remember;
    store.remember = async (state, cluster) => {
      await remember(state, cluster);
      current.state = b;
    };
    await settleCluster(a, async () => ['dev'], store);
    expect(shown).toEqual([]);
  });
});
