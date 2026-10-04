import { describe, expect, it } from 'vitest';
import { lensTitle } from '../src/intel/lensTitle';

const match = (name: string, sources: ('repo' | 'console')[] = ['console']) => ({ name, sources });
const literal = { reading: 'selfServe', type: 'LITERAL' } as const;

describe('lensTitle', () => {
  it('counts what a pattern matches, without listing them', () => {
    const prefixed = {
      value: 'orders.',
      wildcard: false,
      pattern: { reading: 'selfServe', type: 'PREFIXED' },
    } as const;
    expect(lensTitle('Topic', prefixed, [match('orders.a'), match('orders.b')])).toBe(
      '$(search) matches 2 Topic resources',
    );
    const all = Array.from({ length: 2500 }, (_, i) => match(`t${i}`));
    expect(lensTitle('Topic', { value: '*', wildcard: true }, all)).toBe('$(search) all 2500 Topic resources');
  });

  it('names a single match and where it is', () => {
    expect(
      lensTitle('Topic', { value: 'orders', wildcard: false, pattern: literal }, [
        match('orders', ['repo', 'console']),
      ]),
    ).toBe('$(search) orders · repo + Console');
    expect(lensTitle('Topic', { value: 'orders', wildcard: false, pattern: literal }, [])).toBe(
      '$(search) no Topic orders yet',
    );
  });
});
