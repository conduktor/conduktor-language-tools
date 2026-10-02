import { describe, expect, it } from 'vitest';
import { driftNotes, sharedIdentities } from '../src/sync/conflicts';

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

describe('driftNotes', () => {
  it('says which files overwrite a Console change and which re-create a deleted resource', () => {
    expect(
      driftNotes([
        { path: 'a.yaml', drift: 'changed' },
        { path: 'b.yaml' },
        { path: 'c.yaml', drift: 'deleted' },
        { path: 'd.yaml', drift: 'changed' },
      ]),
    ).toEqual([
      'Changed on the Console since they were synced, and will be overwritten: a.yaml, d.yaml.',
      'Deleted from the Console since they were synced, and will be created again: c.yaml.',
    ]);
  });

  it('is empty without drift', () => {
    expect(driftNotes([{ path: 'a.yaml' }])).toEqual([]);
  });
});
