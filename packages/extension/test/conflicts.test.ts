import { describe, expect, it } from 'vitest';
import { sharedIdentities } from '../src/sync/conflicts';

const entry = (path: string, name: string, parents = ['local']) => ({ kind: 'Topic', parents, name, path });

describe('sharedIdentities', () => {
  it('names the files that describe the same resource', () => {
    expect(
      sharedIdentities([
        entry('a.yaml', 'orders'),
        entry('b.yaml', 'payments'),
        entry('c.yaml', 'orders'),
        entry('d.yaml', 'orders', ['staging']),
      ]),
    ).toEqual(['Topic orders: a.yaml, c.yaml']);
  });

  it('is empty when every file is its own resource', () => {
    expect(sharedIdentities([entry('a.yaml', 'a'), entry('b.yaml', 'b')])).toEqual([]);
  });
});
