import { describe, expect, it } from 'vitest';
import { rangeOf, valueAt } from '../src/resources/yamlPaths';

const text = `apiVersion: v1
kind: Application
metadata: { name: shop }
spec:
  owner: 
  members:
    - a@b.io
    - 
  resources:
    - name: orders.
      patternType: PREFIXED
`;

describe('valueAt', () => {
  it('finds the scalar under the cursor with its path', () => {
    const at = text.indexOf('orders.') + 3;
    expect(valueAt(text, at)).toEqual({
      path: ['spec', 'resources', 0, 'name'],
      start: text.indexOf('orders.'),
      end: text.indexOf('orders.') + 7,
      value: 'orders.',
    });
    expect(valueAt(text, text.indexOf('shop'))?.path).toEqual(['metadata', 'name']);
    expect(valueAt(text, text.indexOf('a@b.io'))?.path).toEqual(['spec', 'members', 0]);
  });

  it('finds an empty value, so completion works before anything is typed', () => {
    const at = text.indexOf('owner: ') + 'owner: '.length;
    expect(valueAt(text, at)).toMatchObject({ path: ['spec', 'owner'], value: null, start: at, end: at });
    const item = text.indexOf('    - \n') + '    - '.length;
    expect(valueAt(text, item)).toMatchObject({ path: ['spec', 'members', 1], value: null });
  });

  it('finds nothing on a key or between values', () => {
    expect(valueAt(text, text.indexOf('owner'))).toBeUndefined();
  });

  it('copes with half-written YAML', () => {
    expect(() => valueAt('spec:\n  owner: [\n', 15)).not.toThrow();
  });
});

describe('rangeOf', () => {
  it('gives the range of the value at a path', () => {
    const start = text.indexOf('orders.');
    expect(rangeOf(text, ['spec', 'resources', 0, 'name'])).toEqual([start, start + 7]);
    expect(rangeOf(text, ['spec', 'nothing'])).toBeUndefined();
  });
});
