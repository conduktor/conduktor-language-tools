import { describe, expect, it } from 'vitest';
import { ContentCache } from '../src/sync/contentCache';

describe('ContentCache', () => {
  const counting = () => {
    let calls = 0;
    return { compute: (value: string) => () => (calls++, value), calls: () => calls };
  };

  it('computes once while the content stays the same', () => {
    const cache = new ContentCache<string>();
    const c = counting();
    expect(cache.get('a', ['x', 'base'], c.compute('one'))).toBe('one');
    expect(cache.get('a', ['x', 'base'], c.compute('two'))).toBe('one');
    expect(c.calls()).toBe(1);
  });

  it('computes again when any part changes, a missing part included', () => {
    const cache = new ContentCache<string>();
    cache.get('a', ['x', 'base'], () => 'one');
    expect(cache.get('a', ['x', 'other base'], () => 'two')).toBe('two');
    expect(cache.get('a', ['x', undefined], () => 'three')).toBe('three');
    expect(cache.get('a', ['x', ''], () => 'four')).toBe('four');
    expect(cache.get('a', ['xb', 'ase'], () => 'five')).toBe('five');
  });

  it('forgets keys it is not told to keep, and everything on clear', () => {
    const cache = new ContentCache<string>();
    cache.get('a', ['x'], () => 'a');
    cache.get('b', ['x'], () => 'b');
    cache.retain(['b']);
    expect(cache.get('a', ['x'], () => 'a again')).toBe('a again');
    expect(cache.get('b', ['x'], () => 'b again')).toBe('b');
    cache.clear();
    expect(cache.get('b', ['x'], () => 'b fresh')).toBe('b fresh');
  });
});
