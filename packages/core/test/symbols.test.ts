import { describe, expect, it } from 'vitest';
import { resourceSymbols } from '../src/resources/symbols';
import { snapshotCatalog } from './fixtures';

describe('resourceSymbols', () => {
  it('name each resource of a file, with its kind and parents, over its document and on its name', () => {
    const text =
      'apiVersion: v2\nkind: Topic\nmetadata:\n  name: orders\n  cluster: local-kafka\n---\n# readers\napiVersion: v2\nkind: Group\nmetadata:\n  name: "readers"\nspec: {}\n---\nkind: Deployment\napiVersion: apps/v1\n';
    const symbols = resourceSymbols(text, snapshotCatalog);
    expect(symbols.map((s) => [s.name, s.kind, s.detail, text.slice(s.nameStart, s.nameEnd)])).toEqual([
      ['orders', 'Topic', 'Topic · local-kafka', 'orders'],
      ['readers', 'Group', 'Group', '"readers"'],
    ]);
    expect(text.slice(symbols[1]!.start, symbols[1]!.end)).toMatch(
      /^apiVersion: v2\nkind: Group\n[\s\S]*spec: \{\}\n$/,
    );
  });

  it('name a resource still without one by its kind', () => {
    const text = 'apiVersion: v2\nkind: Topic\nmetadata:\n  cluster: local-kafka\n';
    const [symbol] = resourceSymbols(text, snapshotCatalog);
    expect(symbol).toMatchObject({ name: '(no name)', detail: 'Topic · local-kafka' });
    expect(text.slice(symbol!.nameStart, symbol!.nameEnd)).toBe('Topic');
  });
});
