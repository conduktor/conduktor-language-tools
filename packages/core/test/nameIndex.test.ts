import { describe, expect, it } from 'vitest';
import { describeSources, NameIndex } from '../src/references/nameIndex';

describe('NameIndex', () => {
  it('merges the repository and the Console, per kind and scope', () => {
    const index = new NameIndex();
    index.add('Group', [], 'team-b', 'console');
    index.add('Group', [], 'team-a', 'repo');
    index.add('Group', [], 'team-a', 'console');
    index.add('Topic', ['local'], 'orders', 'console');
    expect(index.list('Group', [])).toEqual([
      { name: 'team-a', sources: ['repo', 'console'] },
      { name: 'team-b', sources: ['console'] },
    ]);
    expect(index.has('Topic', ['local'], 'orders')).toBe(true);
    expect(index.has('Topic', ['prod'], 'orders')).toBe(false);
  });

  it('says where a name was found', () => {
    expect(describeSources(['repo', 'console'])).toBe('repo + Console');
    expect(describeSources(['console'])).toBe('Console');
    expect(describeSources(['repo'])).toBe('repo');
  });
});
